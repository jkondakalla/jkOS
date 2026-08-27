// @jkos/files smoke — drives the REAL rangeStream()/containPath() implementation, not
// a re-implementation of the Range contract. rangeStream is exercised over a real
// http.createServer (plain node:http ServerResponse, no Express) so the assertions
// prove the package works against the base surface every jkOS backend's `res` object
// is built on — the same 200/206/416 + Accept-Ranges/Content-Range contract PapyrOS's
// backend/src/media.js implemented inline before this package existed (git history,
// Wave 17 item 17.1). containPath is exercised directly (pure function, no server needed).
//
//   node packages/files/test/files.smoke.mjs

import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { containPath, rangeStream } = require('../index.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };

const tmp = mkdtempSync(join(tmpdir(), 'jkos-files-'));

// ── containPath ──────────────────────────────────────────────────────────────────────
{
  const root = join(tmp, 'root');
  require('node:fs').mkdirSync(root, { recursive: true });
  require('node:fs').mkdirSync(join(root, 'sub'), { recursive: true });

  ok(containPath(root, 'a.txt') === join(root, 'a.txt'), 'containPath: a plain relative path resolves inside root');
  ok(containPath(root, 'sub/b.txt') === join(root, 'sub', 'b.txt'), 'containPath: a nested relative path resolves inside root');
  ok(containPath(root, '.') === root, 'containPath: "." resolves to root itself (not rejected)');
  ok(containPath(root, '../evil.txt') === null, 'containPath: ".." traversal above root is rejected (null)');
  ok(containPath(root, '../root-evil/x') === null, 'containPath: a sibling directory that merely PREFIX-MATCHES root is rejected (null)');
  ok(containPath(root, '/etc/passwd') === null, 'containPath: an absolute rel (path.resolve ignores root entirely once an absolute segment appears) resolves outside root and is rejected (null)');
}

// ── rangeStream — real file, real http server, real fetch ───────────────────────────
const FILE_SIZE = 5000;
const filePath = join(tmp, 'media.bin');
{
  const buf = Buffer.alloc(FILE_SIZE);
  for (let i = 0; i < FILE_SIZE; i++) buf[i] = i % 256;
  writeFileSync(filePath, buf);
}

const server = http.createServer((req, res) => {
  if (req.url === '/boom') {
    // A path that doesn't exist — statSync inside rangeStream should throw, and this
    // handler's own try/catch stands in for what a real caller (e.g. media.js) does:
    // stat first, 404 before ever calling rangeStream. Proves rangeStream doesn't
    // swallow a stat failure itself.
    try {
      rangeStream(res, join(tmp, 'does-not-exist.bin'), { contentType: 'application/octet-stream' });
    } catch (err) {
      res.statusCode = 599;
      res.end(String(err.code || err.message));
    }
    return;
  }
  rangeStream(res, filePath, {
    range: req.headers.range,
    contentType: 'application/octet-stream',
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

try {
  // 200 — no Range header, whole file.
  {
    const res = await fetch(BASE + '/');
    const body = new Uint8Array(await res.arrayBuffer());
    ok(res.status === 200, `no-Range GET -> 200 (got ${res.status})`);
    ok(res.headers.get('content-length') === String(FILE_SIZE), `no-Range GET Content-Length is ${FILE_SIZE} (got ${res.headers.get('content-length')})`);
    ok(body.length === FILE_SIZE, `no-Range GET body is the whole file (got ${body.length} bytes)`);
    ok(res.headers.get('accept-ranges') === 'bytes', 'no-Range GET still sends Accept-Ranges: bytes');
    ok(res.headers.get('content-type') === 'application/octet-stream', 'no-Range GET sends the opts.contentType');
  }

  // 206 — "bytes=start-end".
  {
    const res = await fetch(BASE + '/', { headers: { Range: 'bytes=100-199' } });
    const body = new Uint8Array(await res.arrayBuffer());
    ok(res.status === 206, `Range bytes=100-199 -> 206 (got ${res.status})`);
    ok(res.headers.get('content-range') === `bytes 100-199/${FILE_SIZE}`, `Content-Range is correct (got ${res.headers.get('content-range')})`);
    ok(res.headers.get('content-length') === '100', `Content-Length is 100 (got ${res.headers.get('content-length')})`);
    ok(body.length === 100 && body[0] === 100 % 256, 'body is exactly the requested 100-byte slice, first byte matches source');
  }

  // 206 — "bytes=start-" (open-ended).
  {
    const res = await fetch(BASE + '/', { headers: { Range: `bytes=${FILE_SIZE - 10}-` } });
    const body = new Uint8Array(await res.arrayBuffer());
    ok(res.status === 206, `Range bytes=N- (open-ended) -> 206 (got ${res.status})`);
    ok(res.headers.get('content-range') === `bytes ${FILE_SIZE - 10}-${FILE_SIZE - 1}/${FILE_SIZE}`, `open-ended Content-Range runs to the last byte (got ${res.headers.get('content-range')})`);
    ok(body.length === 10, `open-ended range returns the last 10 bytes (got ${body.length})`);
  }

  // 206 — "bytes=-suffix".
  {
    const res = await fetch(BASE + '/', { headers: { Range: 'bytes=-50' } });
    const body = new Uint8Array(await res.arrayBuffer());
    ok(res.status === 206, `Range bytes=-50 (suffix) -> 206 (got ${res.status})`);
    ok(res.headers.get('content-range') === `bytes ${FILE_SIZE - 50}-${FILE_SIZE - 1}/${FILE_SIZE}`, `suffix Content-Range covers the last 50 bytes (got ${res.headers.get('content-range')})`);
    ok(body.length === 50, `suffix range body is exactly 50 bytes (got ${body.length})`);
  }

  // 416 — out-of-bounds start.
  {
    const res = await fetch(BASE + '/', { headers: { Range: `bytes=${FILE_SIZE + 10}-${FILE_SIZE + 20}` } });
    ok(res.status === 416, `out-of-bounds Range -> 416 (got ${res.status})`);
    ok(res.headers.get('content-range') === `bytes */${FILE_SIZE}`, `416 Content-Range is "bytes */total" (got ${res.headers.get('content-range')})`);
  }

  // 416 — malformed Range header (not the "bytes=" form at all).
  {
    const res = await fetch(BASE + '/', { headers: { Range: 'nonsense' } });
    ok(res.status === 416, `malformed Range header -> 416 (got ${res.status})`);
  }

  // 416 — multi-range is not supported, falls to unsatisfiable.
  {
    const res = await fetch(BASE + '/', { headers: { Range: 'bytes=0-10,20-30' } });
    ok(res.status === 416, `multi-range Range header -> 416 (got ${res.status})`);
  }

  // A missing file: rangeStream's internal statSync throws synchronously (it does not
  // swallow the error) — the caller is expected to stat/404 first, exactly like
  // PapyrOS's media.js routes do.
  {
    const res = await fetch(BASE + '/boom');
    ok(res.status === 599, `rangeStream propagates a stat failure to the caller instead of swallowing it (got ${res.status})`);
    const body = await res.text();
    ok(body === 'ENOENT', `the propagated error is ENOENT (got ${body})`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
}

// ── opts.stat path, driven directly (not over HTTP) ──────────────────────────────────
{
  const tmp2 = mkdtempSync(join(tmpdir(), 'jkos-files-stat-'));
  const f = join(tmp2, 'x.bin');
  writeFileSync(f, Buffer.from('hello world'));
  const stat = require('node:fs').statSync(f);
  const server2 = http.createServer((req, res) => {
    rangeStream(res, f, { range: req.headers.range, contentType: 'text/plain', stat });
  });
  await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
  const port2 = server2.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port2}/`, { headers: { Range: 'bytes=0-4' } });
    const body = await res.text();
    ok(res.status === 206, `opts.stat path: Range -> 206 (got ${res.status})`);
    ok(body === 'hello', `opts.stat path: body slice is correct (got "${body}")`);
  } finally {
    await new Promise((resolve) => server2.close(resolve));
    rmSync(tmp2, { recursive: true, force: true });
  }
}

console.log(`\n@jkos/files smoke: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
