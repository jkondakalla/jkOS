'use strict';
// fetch-mock-preload.cjs (task 4.4) — `--require`d via NODE_OPTIONS (see meta.smoke.mjs)
// so this file's top-level code runs and replaces globalThis.fetch BEFORE node ever
// begins loading server.js as the entry script. That ordering matters: discovery.js's
// `META.mount(app)` (packages/weave/src/server/connector.js) and src/routes/match.js's
// `createMatchRouter()` both resolve `opts.fetch || globalThis.fetch` — ONCE, synchronously,
// at server BOOT (module top-level code, before app.listen()) — not per request. `--require`
// always runs before the entry script is evaluated, so by the time either module resolves
// its default fetch, globalThis.fetch is already this mock; every request either module
// makes afterward reuses that same captured function reference.
//
// Routes by URL — NO real network ever leaves this process:
//   • https://itunes.apple.com/search...        → the canned iTunes payload (fetch-mock-data.cjs)
//   • an is1-ssl.mzstatic.com .../600x600... URL → fake JPEG bytes
//   • anything else                              → throws loudly. A real-network leak fails
//     the request hard (visible in the server's captured stdout/stderr) instead of hanging
//     the smoke or actually reaching the internet — this is the proof-of-no-leak the task
//     asked for: mutate any route above to widen its match and this branch stops firing.
//
// Every call is appended as one JSON line to FETCH_MOCK_LOG (env var, required) so
// meta.smoke.mjs — a SEPARATE process from this spawned server — can inspect exactly which
// URL(s) (and HTTP method) the connector/match route actually requested.

const fs = require('node:fs');
const { ITUNES_PAYLOAD, FAKE_JPEG_MARKER } = require('./fetch-mock-data.cjs');

const LOG_PATH = process.env.FETCH_MOCK_LOG;
if (!LOG_PATH) throw new Error('fetch-mock-preload: FETCH_MOCK_LOG env var is required');

function record(url, method) {
  fs.appendFileSync(LOG_PATH, JSON.stringify({ url, method }) + '\n');
}

const FAKE_JPEG = Buffer.from(FAKE_JPEG_MARKER, 'utf8');

globalThis.fetch = async function mockFetch(input, init) {
  const url = typeof input === 'string' ? input : (input && input.href) || String(input);
  const method = (init && init.method) || 'GET';
  record(url, method);

  if (url.startsWith('https://itunes.apple.com/search')) {
    return new Response(JSON.stringify(ITUNES_PAYLOAD), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (/^https:\/\/is1-ssl\.mzstatic\.com\/.*600x600/.test(url)) {
    return new Response(FAKE_JPEG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }

  throw new Error(
    `fetch-mock-preload: UNEXPECTED fetch to ${method} ${url} — no real network is allowed `
    + 'in meta.smoke; add a route above instead of letting this leak.'
  );
};

console.warn('[fetch-mock-preload] globalThis.fetch replaced — iTunes search + 600x600 artwork routed to fixtures, everything else throws');
