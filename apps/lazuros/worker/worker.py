#!/usr/bin/env python3
"""LazurOS compute-node worker daemon (Phase 2).

Polls the State node's bearer-gated /internal API for PENDING jobs, atomically
claims one, runs inference via the node-local runtime, and posts the result back.

Composability mandate (Documentation/ARCHITECTURE.md § LazurOS): this file hardcodes no model tags and no
prompt strings. Both come from per-deployment config files — the worker's own
node-local slice, not the State node's full deployment.json:

  - models.json  : { "<capability>": "<model-tag>", ... }
  - prompts.json : { "<capability>": "<template with {field} placeholders>", ... }

A different node serving a different capability subset ships different files; a
node running llama.cpp instead of Ollama points LAZUROS_OLLAMA_URL at it. The
worker code never references a tag, an f-string prompt, or a runtime by name.

Pathing contract (mirrors the State node's backend/lib/http.js):
  - Base URLs are normalized once (trailing slash stripped) and joined with
    api_url()/job_path() — never ad-hoc f-strings scattered through the file.
  - Dynamic path segments (job ids) are percent-quoted.
  - Credentials are scoped to their system: STATE_HEADERS (the internal bearer
    token) goes ONLY to the State node; the inference runtime gets RUNTIME_HEADERS,
    which never carries the token.

Stdlib only — no pip install on the compute node. The HTTP layer is factored into
small helpers so the loop can be exercised against a mocked State node in tests.
"""
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ── Config (env) ────────────────────────────────────────────────────────────────
STATE_URL = os.environ.get('LAZUROS_STATE_URL', 'http://localhost:8080').rstrip('/')
INT_TOKEN = os.environ.get('LAZUROS_INTERNAL_TOKEN', '')
POLL_MS = int(os.environ.get('POLL_INTERVAL_MS', '2000'))
MODEL_MAP_PATH = os.environ.get('LAZUROS_MODEL_MAP', '/opt/lazuros/models.json')
PROMPT_MAP_PATH = os.environ.get('LAZUROS_PROMPT_MAP', '/opt/lazuros/prompts.json')
OLLAMA_URL = os.environ.get('LAZUROS_OLLAMA_URL', 'http://localhost:11434').rstrip('/')

# Credential scoping: the internal token authenticates this worker TO THE STATE NODE
# and must never reach any other system — the runtime headers deliberately omit it.
STATE_HEADERS = {'Authorization': f'Bearer {INT_TOKEN}', 'Content-Type': 'application/json'}
RUNTIME_HEADERS = {'Content-Type': 'application/json'}


# ── URL building (the one pathing seam) ─────────────────────────────────────────
def api_url(path, base=None):
    """Join an absolute path onto the State-node base URL. The base is normalized
    (trailing slash stripped) so 'http://host:8080/' and 'http://host:8080' build
    identical URLs."""
    return f"{(base or STATE_URL).rstrip('/')}{path}"


def job_path(job_id, action=None):
    """/internal/jobs path for one job, with the id percent-quoted. Ids are
    server-issued UUIDs today; quoting means this builder never relies on that."""
    p = f"/internal/jobs/{urllib.parse.quote(str(job_id), safe='')}"
    return f'{p}/{action}' if action else p


# ── HTTP helpers (stdlib, mockable) ─────────────────────────────────────────────
def _request(method, url, headers, body=None, timeout=10):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode('utf-8') or '{}'
        return resp.status, json.loads(raw)


def get_pending(state_url=None, limit=1):
    """Next `limit` PENDING jobs (oldest first). Returns [] on any transport error
    so a flaky State node degrades to an idle poll loop rather than a crash."""
    url = api_url(f'/internal/jobs?{urllib.parse.urlencode({"limit": int(limit)})}', state_url)
    try:
        _, data = _request('GET', url, STATE_HEADERS, timeout=5)
        return data.get('jobs', [])
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f'[worker] poll error: {e}', flush=True)
        return []


def claim(job_id, state_url=None):
    """Atomically flip PENDING → IN_PROGRESS. True only if this worker won the race
    (200); any error — including the 409 a losing peer gets, which urllib raises as
    HTTPError (a URLError subclass) — is False."""
    url = api_url(job_path(job_id, 'claim'), state_url)
    try:
        status, _ = _request('PATCH', url, STATE_HEADERS, timeout=5)
        return status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def post_result(job_id, status, result=None, error=None, state_url=None):
    """Post a terminal/intermediate result. Swallows transport errors (returns False)
    rather than propagating: without this, a State-node outage at result-post time
    crashes the daemon — the FAILED post in process_once's except handler would itself
    raise, uncaught. On failure the job stays IN_PROGRESS and the State node's reaper
    requeues it for a retry, so nothing is lost."""
    url = api_url(job_path(job_id, 'result'), state_url)
    try:
        _request('POST', url, STATE_HEADERS,
                 body={'status': status, 'result': result, 'error': error}, timeout=15)
        return True
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f'[worker] post_result error for job {job_id}: {e}', flush=True)
        return False


def call_ollama(model, prompt, keep_alive=0, ollama_url=None):
    url = f"{(ollama_url or OLLAMA_URL).rstrip('/')}/api/generate"
    _, data = _request('POST', url, RUNTIME_HEADERS,
                       body={'model': model, 'prompt': prompt, 'stream': False,
                             'keep_alive': keep_alive}, timeout=120)
    if 'response' not in data:
        raise ValueError(f'Ollama returned no "response" field (keys: {sorted(data)})')
    return data['response']


# ── Config loading + prompt rendering ───────────────────────────────────────────
def load_json_config(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def build_prompt(capability, payload, prompt_map):
    """Render the capability's prompt template from prompts.json against the job
    payload. The template — never an inline f-string — is the per-deployment content
    decision (Documentation/ToDo.md §1). A missing template is a config error, not a code path."""
    template = prompt_map.get(capability)
    if not template:
        raise ValueError(
            f'no prompt template for capability "{capability}" — add it to {PROMPT_MAP_PATH}')
    try:
        return template.format(**payload)
    except KeyError as e:
        raise ValueError(f'prompt for "{capability}" references missing payload field {e}')


def run_inference(job, model_map, prompt_map):
    capability = job['capability']
    payload = json.loads(job['payload']) if isinstance(job['payload'], str) else job['payload']
    model = model_map.get(capability)
    if not model:
        raise ValueError(
            f'no model configured for capability "{capability}" — add it to {MODEL_MAP_PATH}')
    prompt = build_prompt(capability, payload, prompt_map)
    response = call_ollama(model, prompt)
    return {'response': response, 'model': model}


# ── Main loop ───────────────────────────────────────────────────────────────────
def process_once(model_map, prompt_map, state_url=None):
    """One poll→claim→run→post cycle. Returns the claimed job id if one was
    processed (DONE or FAILED), else None. Pure enough to drive from a test."""
    jobs = get_pending(state_url=state_url)
    if not jobs:
        return None
    job = jobs[0]
    if not claim(job['id'], state_url=state_url):
        return None  # a peer won the race
    try:
        result = run_inference(job, model_map, prompt_map)
        post_result(job['id'], 'DONE', result=result, state_url=state_url)
    except Exception as e:  # noqa: BLE001 — any failure becomes a FAILED job, never a crash
        post_result(job['id'], 'FAILED', error=str(e), state_url=state_url)
    return job['id']


def main():
    if not INT_TOKEN:
        sys.exit('[worker] LAZUROS_INTERNAL_TOKEN not set — refusing to start')
    model_map = load_json_config(MODEL_MAP_PATH)
    prompt_map = load_json_config(PROMPT_MAP_PATH)
    print(f'[worker] up — state={STATE_URL} ollama={OLLAMA_URL} '
          f'capabilities={sorted(model_map)}', flush=True)

    running = {'on': True}
    signal.signal(signal.SIGTERM, lambda *_: running.update(on=False))
    signal.signal(signal.SIGINT, lambda *_: running.update(on=False))

    while running['on']:
        if process_once(model_map, prompt_map) is None:
            time.sleep(POLL_MS / 1000)
    print('[worker] shutting down cleanly', flush=True)


if __name__ == '__main__':
    main()
