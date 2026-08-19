#!/usr/bin/env python3
"""A resume button for the backfill. Local, stdlib, and DISPOSABLE.

    ./.venv/bin/python control.py       →  http://127.0.0.1:8765

§8.6's backfill is a three-hour run that gets stopped and restarted a lot while
§8.7 is being worked out, and `tail -f` on a `\\r` progress line is a poor way to
watch it. This is a Start/Stop button and a progress bar over the same index the
run uses. **It is temporary** — one file, no imports outside the stdlib, nothing
else in the project refers to it, so deleting it costs exactly one `rm`.

WHY IT IS NOT IN KOUROS. The obvious home is the music app, and KourOS staging
cannot host it: that container mounts `/data` and nothing else, has no MUSIC_DIR
mount, no python, no ffmpeg and no 281 MB ONNX graph, and the run it would be
starting lives on a different machine entirely. A button there would be
decoration. The JSON below is the API a KourOS panel would call if the pipeline
ever moves onto the host, so that work is not wasted either way.

⚠️ **127.0.0.1 ONLY.** This endpoint starts processes. It has no authentication
because it is not reachable from anywhere that would need any — and that is a
property of the bind address, so do not "helpfully" change it to 0.0.0.0.
"""
import http.server
import json
import os
import signal
import socketserver
import subprocess
import sys
import time

import index

HERE = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(HERE, '.backfill.pid')
LOG_FILE = os.path.join(HERE, 'out', 'backfill.log')
PORT = int(os.environ.get('MUSIC_CONTROL_PORT', '8765'))

# The interpreter that has onnxruntime. `sys.executable` is right when this is
# started from the venv, which the docstring says to do; the fallback is for the
# system python, where the run would otherwise fail at the first import.
VENV_PYTHON = os.path.join(HERE, '.venv', 'bin', 'python')
PYTHON = sys.executable if 'venv' in sys.executable else (
    VENV_PYTHON if os.path.exists(VENV_PYTHON) else sys.executable)

# (timestamp, vectors) samples, for a rate that reflects the last few minutes
# rather than the whole run. Bounded, because this process outlives many runs.
_HISTORY = []
HISTORY_SECONDS = 300


def running_pid():
    """The live backfill's pid, or None. The pid file is advisory — `/proc` is
    the truth, so a stale file after a crash reads as 'not running'."""
    try:
        with open(PID_FILE) as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        return None
    if not os.path.exists(f'/proc/{pid}'):
        return None
    try:
        with open(f'/proc/{pid}/cmdline', 'rb') as handle:
            if b'backfill.py' not in handle.read():
                return None          # pid was recycled by something else
    except OSError:
        return None
    return pid


def counts():
    conn = index.connect()
    try:
        row = conn.execute('SELECT COUNT(*) AS n FROM tracks').fetchone()
        done = conn.execute('SELECT COUNT(*) AS n FROM local_vectors').fetchone()
        failed = conn.execute(
            'SELECT COUNT(*) AS n FROM tracks WHERE status=?', (index.FAILED,)).fetchone()
        recipe = index.get_meta(conn, 'recipe:local_vectors') or '—'
    finally:
        conn.close()
    return row['n'], done['n'], failed['n'], recipe


def status():
    total, done, failed, recipe = counts()
    now = time.time()
    _HISTORY.append((now, done))
    while _HISTORY and now - _HISTORY[0][0] > HISTORY_SECONDS:
        _HISTORY.pop(0)

    rate = 0.0
    if len(_HISTORY) > 1:
        span = _HISTORY[-1][0] - _HISTORY[0][0]
        grew = _HISTORY[-1][1] - _HISTORY[0][1]
        rate = grew / span if span > 0 else 0.0

    left = max(total - done - failed, 0)
    return {
        'running': running_pid() is not None,
        'pid': running_pid(),
        'total': total,
        'done': done,
        'failed': failed,
        'left': left,
        'percent': round(100.0 * done / total, 2) if total else 0.0,
        'rate': round(rate, 3),
        'eta_seconds': int(left / rate) if rate > 0 else None,
        'recipe': recipe,
        'log_tail': log_tail(),
    }


def log_tail(limit=4000):
    """The last progress line. The backfill rewrites one line with `\\r`, so the
    file has no newlines to seek to — the tail of the bytes is the line. The
    window has to be wide enough to reach back PAST a finished run's closing
    stats dict, which is 250 bytes on its own."""
    try:
        with open(LOG_FILE, 'rb') as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - limit))
            text = handle.read().decode('utf-8', 'replace')
    except OSError:
        return ''
    lines = [l for l in text.replace('\r', '\n').splitlines() if l.strip()]
    # Prefer the last PROGRESS line: a finished run's very last line is the index
    # stats dict, which is a wall of text where a throughput reading should be.
    for line in reversed(lines):
        if 'track/s' in line:
            return line.strip()
    return lines[-1].strip() if lines else ''


def start():
    """Start a run, detached, unless one is already going.

    `start_new_session=True` puts it in its own process group, so restarting or
    killing this server does not take a three-hour run with it. Resuming needs no
    argument — the backfill's work queue is `tracks LEFT JOIN local_vectors`, so
    "resume" and "start" are the same command.
    """
    if running_pid():
        return {'started': False, 'reason': 'already running'}
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    log = open(LOG_FILE, 'ab')
    log.write(f'\n=== started {time.strftime("%Y-%m-%d %H:%M:%S")} ===\n'.encode())
    log.flush()
    proc = subprocess.Popen(
        [PYTHON, os.path.join(HERE, 'backfill.py')],
        cwd=HERE, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
        start_new_session=True,
    )
    with open(PID_FILE, 'w') as handle:
        handle.write(str(proc.pid))
    return {'started': True, 'pid': proc.pid}


def stop():
    """SIGINT first — the backfill catches it, drains its readers and prints a
    summary. SIGTERM only if it is still there, which costs the track in flight
    and nothing else, because every finished track is already committed."""
    pid = running_pid()
    if not pid:
        return {'stopped': False, 'reason': 'not running'}
    os.kill(pid, signal.SIGINT)
    for _ in range(40):
        time.sleep(0.25)
        if not running_pid():
            return {'stopped': True, 'how': 'SIGINT'}
    os.kill(pid, signal.SIGTERM)
    return {'stopped': True, 'how': 'SIGTERM'}


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>music backfill</title>
<style>
 :root { color-scheme: light dark; }
 body { font: 15px/1.5 ui-monospace, monospace; max-width: 46rem; margin: 3rem auto;
        padding: 0 1rem; }
 h1 { font-size: 1.1rem; letter-spacing: .04em; text-transform: uppercase; opacity: .7; }
 .bar { height: 1.5rem; border: 1px solid currentColor; margin: 1rem 0; position: relative; }
 .fill { height: 100%; background: currentColor; opacity: .35; width: 0; transition: width .4s; }
 .bar span { position: absolute; inset: 0; display: grid; place-items: center; }
 button { font: inherit; padding: .5rem 1.4rem; margin-right: .6rem; cursor: pointer; }
 table { border-collapse: collapse; margin: 1rem 0; }
 td { padding: .15rem 1.2rem .15rem 0; }
 td:first-child { opacity: .6; }
 pre { white-space: pre-wrap; opacity: .7; font-size: .85em; }
 .dot { display: inline-block; width: .6rem; height: .6rem; border-radius: 50%;
        background: currentColor; opacity: .3; margin-right: .4rem; }
 .on .dot { opacity: 1; }
</style></head><body>
<h1>music backfill &mdash; §8.6</h1>
<div id="state"><span class="dot"></span><span id="word">checking…</span></div>
<div class="bar"><div class="fill" id="fill"></div><span id="pct"></span></div>
<div>
  <button id="go">Resume</button>
  <button id="halt">Stop</button>
</div>
<table>
 <tr><td>vectors</td><td id="done"></td></tr>
 <tr><td>remaining</td><td id="left"></td></tr>
 <tr><td>failed</td><td id="failed"></td></tr>
 <tr><td>rate</td><td id="rate"></td></tr>
 <tr><td>eta</td><td id="eta"></td></tr>
 <tr><td>recipe</td><td id="recipe"></td></tr>
</table>
<pre id="log"></pre>
<script>
const $ = id => document.getElementById(id);
const hms = s => s == null ? '—' :
  `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
async function tick() {
  const s = await (await fetch('/api/status')).json();
  $('state').className = s.running ? 'on' : '';
  $('word').textContent = s.running ? `running (pid ${s.pid})` : 'stopped';
  $('fill').style.width = s.percent + '%';
  $('pct').textContent = `${s.done} / ${s.total}  —  ${s.percent}%`;
  $('done').textContent = s.done;
  $('left').textContent = s.left;
  $('failed').textContent = s.failed;
  $('rate').textContent = s.rate ? s.rate.toFixed(2) + ' track/s' : '—';
  $('eta').textContent = hms(s.eta_seconds);
  $('recipe').textContent = s.recipe;
  $('log').textContent = s.log_tail;
  $('go').disabled = s.running;
  $('halt').disabled = !s.running;
}
const post = async path => { await fetch(path, {method: 'POST'}); tick(); };
$('go').onclick = () => post('/api/start');
$('halt').onclick = () => post('/api/stop');
tick(); setInterval(tick, 2000);
</script></body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, body, content_type='application/json'):
        payload = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith('/api/status'):
            self._send(json.dumps(status()))
        elif self.path in ('/', '/index.html'):
            self._send(PAGE, 'text/html; charset=utf-8')
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.startswith('/api/start'):
            self._send(json.dumps(start()))
        elif self.path.startswith('/api/stop'):
            self._send(json.dumps(stop()))
        else:
            self.send_error(404)

    def log_message(self, *args):
        pass                     # a poll every 2 s would drown the console


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    # ⚠️ A shell can hand a child SIGINT set to SIG_IGN (nohup does, and so does
    # every non-interactive harness), and Python only installs its
    # KeyboardInterrupt handler when it inherits the default. The Stop button
    # sends SIGINT to get the backfill's graceful drain, so an inherited SIG_IGN
    # would silently downgrade every stop to the SIGTERM fallback ten seconds
    # later. Put it back, for this process and for everything it spawns.
    if signal.getsignal(signal.SIGINT) == signal.SIG_IGN:
        signal.signal(signal.SIGINT, signal.default_int_handler)

    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f'http://127.0.0.1:{PORT}   (python: {PYTHON})')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
