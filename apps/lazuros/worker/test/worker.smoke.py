#!/usr/bin/env python3
"""Phase 2 worker smoke test — drives worker.process_once against a mocked State node
and a mocked inference runtime. No network, no Ollama, no DB. Verifies the unblocked
plumbing: poll → claim → render-prompt → infer → post DONE, plus the FAILED and
lost-the-claim-race paths. Run: python3 test/worker.smoke.py

Assertions are counted; exit non-zero on any failure so the npm `test` wrapper gates."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import worker  # noqa: E402

PASS = {'n': 0}


def ok(cond, label):
    if cond:
        PASS['n'] += 1
    else:
        print(f'  FAIL: {label}')
        sys.exit(1)


MODELS = {'parse-task': 'test-model:tiny'}
PROMPTS = {'parse-task': 'Extract a task from: {text}'}


def make_job(jid='job-1', capability='parse-task', payload='{"text": "buy milk"}'):
    return {'id': jid, 'capability': capability, 'payload': payload}


def install(monkey):
    """Swap the worker's HTTP/inference seams for in-memory fakes; returns a log dict."""
    log = {'claimed': [], 'posted': [], 'inferred': []}
    worker.get_pending = lambda state_url=None, limit=1: monkey['pending']
    worker.claim = lambda jid, state_url=None: (log['claimed'].append(jid), monkey['claim_ok'])[1]

    def _post(jid, status, result=None, error=None, state_url=None):
        log['posted'].append({'id': jid, 'status': status, 'result': result, 'error': error})
    worker.post_result = _post

    def _infer(model, prompt, keep_alive=0, ollama_url=None):
        log['inferred'].append({'model': model, 'prompt': prompt})
        return monkey.get('infer_response', 'OK')
    worker.call_ollama = _infer
    return log


# 0. Pathing contract: one URL builder, normalized bases, quoted ids, scoped creds.
ok(worker.api_url('/internal/jobs', 'http://host:8080/') == 'http://host:8080/internal/jobs',
   'api_url strips a trailing slash before joining')
ok(worker.job_path('a/b c', 'claim') == '/internal/jobs/a%2Fb%20c/claim',
   'job_path percent-quotes the job id')
ok('Authorization' not in worker.RUNTIME_HEADERS,
   'inference runtime headers never carry the internal token')
ok(worker.STATE_HEADERS.get('Authorization', '').startswith('Bearer'),
   'State-node headers carry the bearer token')

# 1. build_prompt renders from the template map, never a hardcoded string.
ok(worker.build_prompt('parse-task', {'text': 'hi'}, PROMPTS) == 'Extract a task from: hi',
   'build_prompt renders template')

# 2. missing template → config error (not a silent empty prompt).
try:
    worker.build_prompt('unknown-cap', {}, PROMPTS)
    ok(False, 'missing template should raise')
except ValueError:
    ok(True, 'missing template raises ValueError')

# 3. happy path: poll → claim → infer → post DONE with model + response.
log = install({'pending': [make_job()], 'claim_ok': True, 'infer_response': 'parsed!'})
jid = worker.process_once(MODELS, PROMPTS)
ok(jid == 'job-1', 'process_once returns claimed job id')
ok(log['claimed'] == ['job-1'], 'job was claimed')
ok(len(log['inferred']) == 1 and log['inferred'][0]['model'] == 'test-model:tiny',
   'inference ran with the configured model tag')
ok(log['inferred'][0]['prompt'] == 'Extract a task from: buy milk', 'prompt rendered from payload')
ok(len(log['posted']) == 1 and log['posted'][0]['status'] == 'DONE', 'posted DONE')
ok(log['posted'][0]['result'] == {'response': 'parsed!', 'model': 'test-model:tiny'},
   'result carries response + model')

# 4. idle: no pending jobs → no claim, no post, returns None.
log = install({'pending': [], 'claim_ok': True})
ok(worker.process_once(MODELS, PROMPTS) is None, 'idle poll returns None')
ok(log['claimed'] == [] and log['posted'] == [], 'idle poll does nothing')

# 5. lost the claim race → no inference, no post, returns None.
log = install({'pending': [make_job()], 'claim_ok': False})
ok(worker.process_once(MODELS, PROMPTS) is None, 'lost-race returns None')
ok(log['inferred'] == [] and log['posted'] == [], 'lost-race runs no inference')

# 6. unconfigured capability → FAILED job (never a crash, never a wrong model).
log = install({'pending': [make_job(capability='no-such-cap')], 'claim_ok': True})
worker.process_once(MODELS, PROMPTS)
ok(len(log['posted']) == 1 and log['posted'][0]['status'] == 'FAILED', 'unconfigured cap → FAILED')
ok('no model configured' in log['posted'][0]['error'], 'FAILED carries the config error')

# 7. inference raising → FAILED, not a crash.
log = install({'pending': [make_job()], 'claim_ok': True})
def _boom(*a, **k):
    raise RuntimeError('runtime down')
worker.call_ollama = _boom
worker.process_once(MODELS, PROMPTS)
ok(log['posted'][0]['status'] == 'FAILED' and 'runtime down' in log['posted'][0]['error'],
   'inference error → FAILED with message')

print(f'worker smoke: {PASS["n"]}/{PASS["n"]} assertions passed')
