// session.smoke.mjs — the listening session ("Connect"): one session per listener,
// shared by every KourOS instance they are signed in on, any of which can be the
// OUTPUT while the rest are remotes for it. Boots the REAL server (empty libraries —
// nothing here plays audio; the server only relays and records) with a real RS256
// keypair, and drives it as two listeners on three devices each, over raw HTTP and
// raw SSE streams.
//
// Asserts:
//   · pure — validate.js accepts a queue whose shuffle order went stale after
//     shuffle-off + remove (the player really produces one; refusing it would 400
//     every report of a working player), drops that order, and still refuses a
//     broken permutation while shuffle is ON; livePositionMs extrapolates only
//     while playing, at the rate, and never past the watchdog window; a router that
//     boots with a session left playing arms the watchdog itself.
//   · the stream — 401 without a token, 404 for an unregistered device, the SSE
//     headers that keep nginx and Cloudflare from buffering it, `hello` carrying the
//     snapshot, presence as `devices` events, and `reauth` then close AT the token's
//     `exp` (a stream must not outlive its credential).
//   · routing — only the OUTPUT may report (409 NOT_ACTIVE otherwise); a command is
//     relayed to the output and nowhere else, a volume to the device it names; with
//     no output online it is 409 NO_ACTIVE_DEVICE; a transfer tells the old output to
//     release and the new one to take over at the EXTRAPOLATED position.
//   · isolation — listener B never sees an event of A's, and cannot address A's
//     devices (a device id names a device only within its listener).
//   · idempotency — a repeated idempotency_key relays ONCE and replays the reply;
//     a 409 is NOT remembered, so the same key succeeds once an output exists.
//   · the vanished output — when the output's last stream closes while playing,
//     the session is recorded paused after the grace, at the second the stream
//     CLOSED (not the second the timer fired); a reconnect within the grace cancels.
//   · validation + limits — bad ids, ops, refs, an oversized queue → 400; a
//     per-listener write rate limit and a per-listener stream cap → 429.
//   · the declared contract — the six capabilities and the `session` dataset.
//
//   node apps/kouros/backend/test/session.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign as cryptoSign, randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const require = createRequire(import.meta.url);

// Claimed in the suite-manifest port registry ('kouros:session.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3993;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVICE = 'kouros';
const ISSUER = 'jkos-auth';
/** The server's offline grace, shortened so the smoke can wait it out. */
const GRACE_MS = 600;
/** The report watchdog, shortened too — but longer than any stretch below in which
 *  a session is playing between two reports, so it only bites where it is meant to. */
const STALE_MS = 4000;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1. Pure — no server ───────────────────────────────────────────────────────── */
{
  const V = require('../src/session/validate.js');
  const { livePositionMs } = require('../src/session/routes.js');

  // Shuffle on over 5 → off → remove one: 4 items, the old 5-long order still held
  // (queue.ts's shuffle(q, false) keeps it; removeAt only re-shuffles while ON).
  const stale = V.queue({ items: ['1', '2', '3', '4'], cursor: 1,
    policy: { shuffle: false, repeat: 'off', shuffleSeed: 7, shuffleOrder: [4, 0, 2, 1, 3] } });
  ok(typeof stale === 'object' && stale.policy.shuffleOrder.length === 0,
    `a stale shuffle order under shuffle-off is accepted and dropped (got ${JSON.stringify(stale)})`);
  const on = V.queue({ items: ['1', 'book:2', 'kouros:3'], cursor: 0,
    policy: { shuffle: true, repeat: 'all', shuffleSeed: 7, shuffleOrder: [2, 0, 1] } });
  ok(typeof on === 'object' && on.policy.shuffleOrder.join() === '2,0,1', 'a whole permutation under shuffle-on is kept verbatim');
  ok(typeof V.queue({ items: ['1', '2', '3'], cursor: 0,
    policy: { shuffle: true, repeat: 'off', shuffleSeed: 7, shuffleOrder: [0, 0, 1] } }) === 'string',
    'a shuffle order that is not a permutation is refused while shuffle is on');
  ok(typeof V.queue({ items: ['1'], cursor: -1, policy: { shuffle: false, repeat: 'off', shuffleSeed: 1, shuffleOrder: [] } }) === 'string',
    'cursor -1 on a non-empty queue is refused (the empty-queue invariant)');
  ok(typeof V.queue({ items: ['nope:1'], cursor: 0, policy: { shuffle: false, repeat: 'off', shuffleSeed: 1, shuffleOrder: [] } }) === 'string',
    'a ref outside the grammar is refused');

  const t = Date.parse('2026-09-24T00:00:00.000Z');
  const s = { position_ms: 10_000, playing: true, rate: 1.5, reported_at: new Date(t).toISOString() };
  ok(livePositionMs(s, t + 2000) === 13_000, 'livePositionMs extrapolates at the rate while playing');
  ok(livePositionMs({ ...s, playing: false }, t + 2000) === 10_000, 'livePositionMs holds still while paused');
  ok(livePositionMs(s, t - 5000) === 10_000, 'livePositionMs never runs backwards on a clock behind the report');
  ok(livePositionMs(s, t + 3_600_000, 4000) === 16_000,
    'livePositionMs extrapolates at most the watchdog window — a report an hour old hands over +4 s, not +1.5 h');

  // Migration 15 on a table migration 13 built BEFORE the sleep columns existed.
  const Database = require('better-sqlite3');
  const { addSleepColumns } = require('../src/session/store.js');
  const old = new Database(':memory:');
  old.exec('CREATE TABLE listening_session (user_id INTEGER PRIMARY KEY, rev INTEGER, queue TEXT NOT NULL)');
  addSleepColumns(old);
  addSleepColumns(old);   // idempotent — a second boot, or a fresh DB that already has them
  const cols = old.prepare('PRAGMA table_info(listening_session)').all().map((c) => c.name);
  ok(cols.includes('sleep_mode') && cols.includes('sleep_remaining_ms'), 'migration 15 adds the sleep columns to an older table, idempotently');
  old.close();

  // A restart (every deploy) with a session left PLAYING and its output silent: the
  // boot must arm the watchdog itself, since no write or closing stream ever will.
  const { createSessionStore, SESSION_DDL, DEVICES_DDL } = require('../src/session/store.js');
  const { createSessionRouter } = require('../src/session/routes.js');
  const { createHub } = require('../src/session/hub.js');
  const booted = new Database(':memory:');
  booted.exec(SESSION_DDL); booted.exec(DEVICES_DDL);
  const bootStore = createSessionStore(booted);
  bootStore.write(901, { active_device: randomUUID(), item_ref: '1', position_ms: 42_000, playing: true,
    queue: { items: ['1'], cursor: 0, policy: { shuffle: false, repeat: 'off', shuffleSeed: 1, shuffleOrder: [] } } });
  createSessionRouter({ db: booted, store: bootStore, hub: createHub(), reportStaleMs: 150 });
  await sleep(400);
  const after = bootStore.session(901);
  ok(after.playing === false && after.position_ms === 42_000,
    `a session left playing across a restart is paused by the boot's watchdog, where it last reported (got playing=${after.playing} at ${after.position_ms})`);
  booted.close();
}

/* ── 2. The real server ────────────────────────────────────────────────────────── */
const tmp = mkdtempSync(join(tmpdir(), 'kouros-session-'));
const DB_PATH = join(tmp, 'test.db');
const MUSIC_DIR = join(tmp, 'empty-music');
const BOOKS_DIR = join(tmp, 'empty-books');
mkdirSync(MUSIC_DIR, { recursive: true });
mkdirSync(BOOKS_DIR, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mkToken(claims, ttlSec = 900) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: '1' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + ttlSec, ...claims }));
  const input = `${header}.${payload}`;
  return `${input}.${b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey))}`;
}
const A = mkToken({ sub: 801, role: 'user', scope: ['kouros:write'] });
const B = mkToken({ sub: 802, role: 'user', scope: ['kouros:write'] });
const C = mkToken({ sub: 803, role: 'user', scope: ['kouros:write'] });
const D = mkToken({ sub: 804, role: 'user', scope: ['kouros:write'] });

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json, headers: r.headers };
}

/** One SSE connection, read with fetch the way the client will (not EventSource —
 *  it cannot see a status code). `take(pred)` consumes events IN ORDER. */
function openStream(token, deviceId) {
  const ac = new AbortController();
  const s = { events: [], cursor: 0, status: null, headers: null, ended: false };
  s.ready = fetch(`${BASE}/api/session/events?device=${deviceId}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: ac.signal,
  }).then(async (r) => {
    s.status = r.status; s.headers = r.headers;
    if (r.status !== 200) { s.ended = true; s.body = await r.json().catch(() => null); return; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); } catch { break; }
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(':')) continue;   // a ping comment
          const ev = { event: 'message', data: null };
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
          }
          s.events.push(ev);
        }
      }
      s.ended = true;
    })();
  }).catch(() => { s.ended = true; });
  s.close = () => ac.abort();
  /** The next event (from the cursor on) matching `pred`, or null after `ms`. */
  s.take = async (pred, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      for (let i = s.cursor; i < s.events.length; i++) {
        if (pred(s.events[i])) { s.cursor = i + 1; return s.events[i]; }
      }
      if (Date.now() > deadline) return null;
      await sleep(15);
    }
  };
  /** Did any event matching `pred` arrive (from the cursor on) within `ms`? */
  s.saw = async (pred, ms = 300) => { await sleep(ms); return s.events.slice(s.cursor).some(pred); };
  return s;
}
const isCmd = (op) => (e) => e.event === 'command' && e.data.op === op;
const isSession = (pred = () => true) => (e) => e.event === 'session' && pred(e.data.session);

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH,
    MUSIC_DIR, AUDIOBOOKS_DIR: BOOKS_DIR,
    JKOS_AUTH_PUBLIC_KEY: publicKey, JKOS_AUTH_ISSUER: ISSUER,
    KOUROS_SESSION_OFFLINE_GRACE_MS: String(GRACE_MS),
    KOUROS_SESSION_STALE_MS: String(STALE_MS),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let exited = null;
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
child.on('exit', (code) => { exited = code; });

async function waitFor(fn, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited !== null) return false;
    try { if (await fn()) return true; } catch { /* not yet */ }
    await sleep(200);
  }
  return false;
}

const streams = [];
function done() {
  for (const s of streams) s.close();
  child.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
  if (fail) console.error(`\n── server log ──\n${serverLog}`);
  console.log(`\nsession.smoke: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
const stream = (token, id) => { const s = openStream(token, id); streams.push(s); return s; };

const queueOf = (items, cursor = 0, policy = {}) => ({
  items, cursor, policy: { shuffle: false, repeat: 'off', shuffleSeed: 1, shuffleOrder: [], ...policy },
});

try {
  const up = await waitFor(async () => {
    const r = await fetch(BASE + '/health');
    if (!r.ok) return false;
    const body = await r.json();
    if (body.service !== SERVICE) throw new Error(`port ${PORT} answered as ${body.service}`);
    return true;
  });
  if (!up) throw new Error('server never became healthy');

  /* ── The declared contract ── */
  const caps = (await req('GET', '/api/capabilities')).json;
  const ids = new Set((caps.capabilities || []).map((c) => c.id));
  for (const id of ['registerSessionDevice', 'renameSessionDevice', 'forgetSessionDevice', 'reportSessionState', 'sendSessionCommand', 'transferSession']) {
    ok(ids.has(id), `capability ${id} is declared`);
  }
  const cmdCap = caps.capabilities.find((c) => c.id === 'sendSessionCommand');
  ok(cmdCap && cmdCap.body.some((f) => f.name === 'idempotency_key'), 'sendSessionCommand declares idempotency_key (a relay is not idempotent by construction)');
  const sets = (await req('GET', '/api/datasets')).json;
  ok((sets.datasets || []).some((d) => d.id === 'session' && d.path === '/session'), 'the session dataset is declared at /session');

  /* ── The gate + the empty session ── */
  ok((await req('GET', '/api/session')).status === 401, 'GET /api/session without a token → 401');
  const empty = (await req('GET', '/api/session', undefined, A)).json;
  ok(empty && empty.session.rev === 0 && empty.session.active_device === null && empty.devices.length === 0 && typeof empty.serverNow === 'string',
    'a listener with no session reads rev 0, no output, no devices, and serverNow');

  /* ── Devices ── */
  const A1 = randomUUID(), A2 = randomUUID(), A3 = randomUUID(), B1 = randomUUID(), B2 = randomUUID();
  const reg = (tok, deviceId, name, kind = 'desktop') => req('POST', '/api/session/devices', { deviceId, name, kind, platform: 'Smoke' }, tok);
  const r1 = await reg(A, A1, 'Laptop');
  ok(r1.status === 201 && r1.json.device.id === A1 && r1.json.device.online === false, `register → 201, the device, offline until it streams (got ${r1.status})`);
  await reg(A, A2, 'Phone', 'phone');
  await reg(A, A3, 'Tablet', 'tablet');
  await reg(B, B1, 'B desk');
  await reg(B, B2, 'B phone', 'phone');
  ok((await reg(A, 'not-a-uuid', 'X')).status === 400, 'a device id that is not a UUID → 400');
  ok((await reg(A, randomUUID(), 'X', 'toaster')).status === 400, 'an unknown device kind → 400');
  ok((await reg(A, randomUUID(), 'x'.repeat(61))).status === 400, 'a 61-character name → 400');
  const vol3 = await req('POST', '/api/session/devices', { deviceId: A3, name: 'Tablet', kind: 'tablet', volume: 0.4, muted: true }, A);
  ok(vol3.status === 201 && vol3.json.device.volume === 0.4 && vol3.json.device.muted === true,
    'a device that is not the output announces its own volume through registration');
  ok((await req('POST', '/api/session/devices', { deviceId: A3, name: 'Tablet', kind: 'tablet', volume: 7 }, A)).status === 400, 'a volume out of range → 400');

  const noReg = stream(A, randomUUID()); await noReg.ready;
  ok(noReg.status === 404 && noReg.body && noReg.body.code === 'UNKNOWN_DEVICE', `a stream for an unregistered device → 404 UNKNOWN_DEVICE (got ${noReg.status})`);
  const badDev = stream(A, 'nope'); await badDev.ready;
  ok(badDev.status === 400, 'a stream with a malformed device id → 400');
  // B cannot open a stream AS one of A's devices: the id names nothing in B's namespace.
  const forged = stream(B, A1); await forged.ready;
  ok(forged.status === 404, "B opening a stream with A's device id → 404 (ids are per-listener)");

  /* ── Streams ── */
  const sA1 = stream(A, A1), sA2 = stream(A, A2), sB1 = stream(B, B1);
  await Promise.all([sA1.ready, sA2.ready, sB1.ready]);
  ok(sA1.status === 200, 'the stream opens → 200');
  ok(/^text\/event-stream/.test(sA1.headers.get('content-type') || ''), 'Content-Type: text/event-stream');
  ok(sA1.headers.get('x-accel-buffering') === 'no', 'X-Accel-Buffering: no (nginx must not buffer it)');
  ok(/no-transform/.test(sA1.headers.get('cache-control') || ''), 'Cache-Control carries no-transform (nothing may compress or hold it)');
  const hello = await sA1.take((e) => e.event === 'hello');
  ok(hello && hello.data.device === A1 && hello.data.session.rev === 0 && Array.isArray(hello.data.devices),
    'hello carries this device and the snapshot');
  const pres = await sA1.take((e) => e.event === 'devices' && e.data.devices.find((d) => d.id === A2)?.online);
  ok(!!pres, 'A1 hears A2 come online (presence is live)');
  ok(!(await sB1.saw((e) => e.event === 'devices' && e.data.devices.some((d) => d.id === A1 || d.id === A2), 100)),
    "B never hears A's presence");

  /* ── No output yet ── */
  const rep = (tok, deviceId, over = {}) => req('POST', '/api/session/state', {
    deviceId, queue: queueOf(['kouros:1', 'kouros:2', 'book:3']), item_ref: 'kouros:1',
    context: 'album/The%20Band/First', position_ms: 0, playing: true, rate: 1, volume: 0.8, ...over,
  }, tok);
  const orphan = await rep(A, A1);
  ok(orphan.status === 409 && orphan.json.code === 'NOT_ACTIVE', `a report while nobody is the output → 409 NOT_ACTIVE (got ${orphan.status})`);
  const nobody = await req('POST', '/api/session/commands', { op: 'pause', from: A2 }, A);
  ok(nobody.status === 409 && nobody.json.code === 'NO_ACTIVE_DEVICE', 'a command with no output → 409 NO_ACTIVE_DEVICE (the caller takes the output itself)');
  ok((await req('POST', '/api/session/transfer', { to: A3 }, A)).status === 409, 'a transfer to an OFFLINE device → 409');
  ok((await req('POST', '/api/session/transfer', { to: randomUUID() }, A)).status === 404, 'a transfer to an unknown device → 404');
  ok((await req('POST', '/api/session/transfer', { to: B1 }, A)).status === 404, "A cannot transfer to B's device → 404");

  /* ── A1 becomes the output ── */
  const tr = await req('POST', '/api/session/transfer', { to: A1, play: true }, A);
  ok(tr.status === 200 && tr.json.session.active_device === A1 && tr.json.session.rev === 1, 'transfer to A1 → A1 is the output, rev 1');
  const take = await sA1.take(isCmd('takeover'));
  ok(take && take.data.args.play === true && take.data.args.session.active_device === A1 && take.data.from === null && typeof take.data.id === 'string',
    'A1 is told to take over (a server command: from null, with an id)');
  ok(!!(await sA2.take(isSession((s) => s.active_device === A1))), 'A2 sees the new output');
  ok(!(await sA2.saw(isCmd('takeover'), 50)), 'the takeover goes to A1 only');

  const tReport = Date.now();
  const good = await rep(A, A1, { position_ms: 30_000 });
  ok(good.status === 200 && good.json.session.rev === 2 && good.json.session.item_ref === 'kouros:1' && good.json.session.playing === true,
    `the output's report is stored (rev 2, item, playing) (got ${good.status} ${JSON.stringify(good.json)})`);
  ok(typeof good.json.session.reported_at === 'string' && Math.abs(Date.parse(good.json.session.reported_at) - tReport) < 2000,
    'reported_at is stamped by the server at receipt');
  ok(good.json.session.context === 'album/The%20Band/First', 'the context the queue came from is kept');
  const seenByA2 = await sA2.take(isSession((s) => s.rev === 2));
  ok(seenByA2 && seenByA2.data.session.position_ms === 30_000 && typeof seenByA2.data.serverNow === 'string', 'A2 receives the report as a session event, with serverNow');
  ok(!(await sB1.saw((e) => e.event === 'session', 50)), "B never receives A's session");
  const second = await rep(A, A2);
  ok(second.status === 409 && second.json.code === 'NOT_ACTIVE' && second.json.active_device === A1, 'a report from a device that is NOT the output → 409 NOT_ACTIVE');
  const staleShuffle = await rep(A, A1, {
    queue: { items: ['kouros:1', 'kouros:2'], cursor: 0, policy: { shuffle: false, repeat: 'off', shuffleSeed: 9, shuffleOrder: [2, 1, 0] } },
    position_ms: 31_000,
  });
  ok(staleShuffle.status === 200 && staleShuffle.json.session.queue.policy.shuffleOrder.length === 0,
    `a working player's stale shuffle order does not 400 its report (got ${staleShuffle.status})`);
  ok((await rep(A, A1, { item_ref: '../etc' })).status === 400, 'a malformed item_ref → 400');
  ok((await rep(A, A1, { context: 'javascript:alert(1)' })).status === 400, 'a context that is not a KourOS route → 400');
  ok((await rep(A, A1, { queue: queueOf(Array.from({ length: 5001 }, (_, i) => String(i))) })).status === 400, 'a 5001-item queue → 400');
  ok((await rep(A, A1, { rate: 9 })).status === 400, 'a rate out of range → 400');
  const slept = await rep(A, A1, { position_ms: 32_000, sleep_mode: '30', sleep_remaining_ms: 1_700_000 });
  ok(slept.status === 200 && slept.json.session.sleep_mode === '30' && slept.json.session.sleep_remaining_ms === 1_700_000,
    "the output's sleep timer is carried, so a remote can show it counting down");
  ok((await rep(A, A1, { sleep_mode: 'forever' })).status === 400, 'an unknown sleep_mode → 400');
  ok((await rep(A, A1, { sleep_mode: 'segment', sleep_remaining_ms: 5 })).status === 400, "'segment' (end of chapter) carries no remaining time → 400");
  ok((await rep(A, A1, { sleep_mode: 'off' })).json?.session.sleep_mode === null, "'off' is stored as no timer");
  const sessNow = (await req('GET', '/api/session', undefined, A)).json;
  ok(sessNow.devices.find((d) => d.id === A1).volume === 0.8, "the output's reported volume is kept on its device row");

  /* ── Commands ── */
  const pause = await req('POST', '/api/session/commands', { op: 'pause', from: A2 }, A);
  ok(pause.status === 202 && pause.json.target === A1, `a command → 202, relayed to the output (got ${pause.status})`);
  const got = await sA1.take(isCmd('pause'));
  ok(got && got.data.from === A2, 'the output receives it, naming the sender');
  ok(!(await sA2.saw(isCmd('pause'), 50)), 'the sender does not receive its own command');
  ok(!(await sB1.saw((e) => e.event === 'command', 50)), "B never receives A's commands");
  const seek = await req('POST', '/api/session/commands', { op: 'load', args: { items: ['kouros:4', 'book:5'], startIndex: 1, context: 'book/5' }, from: A2 }, A);
  ok(seek.status === 202 && (await sA1.take(isCmd('load')))?.data.args.items.join() === 'kouros:4,book:5', 'load relays its validated items');
  ok((await req('POST', '/api/session/commands', { op: 'explode', from: A2 }, A)).status === 400, 'an unknown op → 400');
  ok((await req('POST', '/api/session/commands', { op: 'load', args: { items: ['x'], startIndex: 0 }, from: A2 }, A)).status === 400, 'a load of a non-ref → 400');
  ok((await req('POST', '/api/session/commands', { op: 'seek', args: { position_ms: -1 }, from: A2 }, A)).status === 400, 'a negative seek → 400');
  ok((await req('POST', '/api/session/commands', { op: 'pause', from: randomUUID() }, A)).status === 404, 'a `from` that is not one of your devices → 404');
  ok((await req('POST', '/api/session/commands', { op: 'pause' }, A)).status === 202, 'a command with no `from` (a routine, a script) is relayed');
  await sA1.take(isCmd('pause'));

  // A volume goes to the device it NAMES, not to the output.
  const vol = await req('POST', '/api/session/commands', { op: 'volume', args: { device: A2, level: 0.3 }, from: A1 }, A);
  ok(vol.status === 202 && vol.json.target === A2, 'volume is relayed to the device it names');
  ok((await sA2.take(isCmd('volume')))?.data.args.level === 0.3, 'that device receives it');
  ok(!(await sA1.saw(isCmd('volume'), 50)), 'the output does not');

  /* ── Idempotency ── */
  const key = `smoke-${randomUUID()}`;
  const k1 = await req('POST', '/api/session/commands', { op: 'next', from: A2, idempotency_key: key }, A);
  const k2 = await req('POST', '/api/session/commands', { op: 'next', from: A2, idempotency_key: key }, A);
  ok(k1.status === 202 && k2.status === 202 && k1.json.id === key && k2.json.id === key, 'a repeated idempotency_key answers the same reply');
  ok(k2.headers.get('idempotent-replay') === 'true', 'the replay says so (Idempotent-Replay: true)');
  await sleep(150);
  ok(sA1.events.slice(sA1.cursor).filter(isCmd('next')).length === 1, 'the output received the command ONCE');
  await sA1.take(isCmd('next'));
  ok((await req('POST', '/api/session/commands', { op: 'next', from: A2, idempotency_key: 'x'.repeat(201) }, A)).status === 400,
    'an over-long idempotency_key is refused, not ignored');
  // A refusal is not a first attempt: the same key works once there is an output.
  const bKey = `smoke-${randomUUID()}`;
  const bFirst = await req('POST', '/api/session/commands', { op: 'play', from: B1, idempotency_key: bKey }, B);
  ok(bFirst.status === 409, 'B, with no output, is refused');
  ok((await req('POST', '/api/session/transfer', { to: B1 }, B)).status === 200, 'B takes the output');
  const bRetry = await req('POST', '/api/session/commands', { op: 'play', from: B1, idempotency_key: bKey }, B);
  ok(bRetry.status === 202 && bRetry.headers.get('idempotent-replay') !== 'true', 'the SAME key then relays — a 409 was never remembered as its answer');
  // Scoped by user: A's key means nothing to B.
  const bSameKey = await req('POST', '/api/session/commands', { op: 'next', from: B1, idempotency_key: key }, B);
  ok(bSameKey.status === 202 && bSameKey.headers.get('idempotent-replay') !== 'true', "A's key replays nothing for B (keys are scoped per listener)");

  /* ── Transfer between devices ── */
  await rep(A, A1, { position_ms: 60_000, playing: true, sleep_mode: '15', sleep_remaining_ms: 900_000 });
  await sleep(250);
  const move = await req('POST', '/api/session/transfer', { to: A2 }, A);
  ok(move.status === 200 && move.json.session.active_device === A2, 'transfer A1 → A2');
  ok(!!(await sA1.take(isCmd('release'))), 'the old output is told to release');
  const over = await sA2.take(isCmd('takeover'));
  const handed = over && over.data.args.session.position_ms;
  ok(handed >= 60_200 && handed < 62_000, `the new output takes over where the music HAS got to, not where it was reported (${handed} ms)`);
  ok(over && over.data.args.play === true, 'a playing session keeps playing across the hand-off');
  ok(over && over.data.args.session.sleep_mode === null, "a sleep timer does not follow a transfer — it ran on the old output");

  /* ── The anchor moves on EVERY report ── */
  const same1 = (await rep(A, A2, { position_ms: 90_000, playing: true })).json.session;
  await sleep(300);
  const same2 = (await rep(A, A2, { position_ms: 90_000, playing: true })).json.session;
  ok(Date.parse(same2.reported_at) - Date.parse(same1.reported_at) >= 250,
    'a report of the SAME position re-anchors reported_at (a stalled output must not be extrapolated past)');

  /* ── The vanished output ── */
  const sA3x = stream(A, A3); await sA3x.ready;   // a remote, to close DURING the grace
  const tA2 = Date.now();
  await rep(A, A2, { position_ms: 100_000, playing: true });
  await sleep(200);
  const tClose = Date.now();
  sA2.close();
  await sleep(GRACE_MS / 3);
  sA3x.close();   // a REMOTE leaving must not cancel the output's pending pause
  const paused = await sA1.take(isSession((s) => s.playing === false && s.active_device === A2), GRACE_MS + 2000);
  const at = paused && paused.data.session.position_ms;
  const heard = tClose - tA2;
  ok(!!paused, 'an output that vanishes mid-song is recorded PAUSED after the grace');
  ok(at >= 100_000 + heard - 150 && at <= 100_000 + heard + 200,
    `…at the second its stream closed (${at} ms, expected ≈ ${100_000 + heard}), not the second the timer fired (≈ ${100_000 + heard + GRACE_MS})`);
  ok(paused && paused.data.session.active_device === A2, '…and it stays the output, to resume when it returns');

  // Back within the grace: nothing is paused.
  await req('POST', '/api/session/transfer', { to: A1, play: true }, A);
  await sA1.take(isCmd('takeover'));
  await rep(A, A1, { position_ms: 5_000, playing: true });
  const sA1b = stream(A, A1); await sA1b.ready;   // a second tab of A1 keeps it online…
  sA1.close();                                    // …so the first closing is not an absence
  await sleep(100);
  sA1b.close();                                   // now A1 is gone —
  await sleep(GRACE_MS / 3);
  const sA1c = stream(A, A1); await sA1c.ready;   // — and back within the grace
  await sleep(GRACE_MS + 300);
  const still = (await req('GET', '/api/session', undefined, A)).json.session;
  ok(still.playing === true && still.active_device === A1, 'an output back within the grace (a reauth recycle, a network hop) is never paused');

  /* ── Devices: rename, re-register, forget ── */
  const sA3 = stream(A, A3); await sA3.ready;
  ok((await req('PATCH', `/api/session/devices/${A2}`, { name: 'Jag’s phone' }, A)).status === 200, 'rename → 200');
  ok(!!(await sA3.take((e) => e.event === 'devices' && e.data.devices.find((d) => d.id === A2)?.name === 'Jag’s phone')), 'every device hears the rename');
  await reg(A, A2, 'Phone', 'phone');
  ok((await req('GET', '/api/session', undefined, A)).json.devices.find((d) => d.id === A2).name === 'Jag’s phone',
    'a re-registration (every boot) does not overwrite a chosen name');
  ok((await req('PATCH', `/api/session/devices/${B1}`, { name: 'mine now' }, A)).status === 404, "A cannot rename B's device");
  const online = await req('DELETE', `/api/session/devices/${A3}`, undefined, A);
  ok(online.status === 409 && online.json.code === 'DEVICE_ONLINE', 'forgetting an ONLINE device → 409');
  sA3.close();
  await sleep(100);
  ok((await req('DELETE', `/api/session/devices/${A3}`, undefined, A)).status === 200, 'forgetting an offline device → 200');
  ok(!(await req('GET', '/api/session', undefined, A)).json.devices.some((d) => d.id === A3), '…and it is gone');

  /* ── A stream never outlives its token ── */
  const shortB = mkToken({ sub: 802, role: 'user', scope: ['kouros:write'] }, 2);
  const sB2 = stream(shortB, B2); await sB2.ready;
  const reauth = await sB2.take((e) => e.event === 'reauth', 4000);
  ok(reauth && reauth.data.reason === 'token-expiry', 'the stream says `reauth` at the token\'s exp');
  await sleep(200);
  ok(sB2.ended, '…and closes');

  /* ── An output that goes SILENT without closing anything ── */
  // A phone out of signal: its stream is still "open", it simply stops reporting.
  const D1 = randomUUID(), D2 = randomUUID();
  await reg(D, D1, 'D phone', 'phone'); await reg(D, D2, 'D desk');
  const sD1 = stream(D, D1), sD2 = stream(D, D2);
  await Promise.all([sD1.ready, sD2.ready]);
  await req('POST', '/api/session/transfer', { to: D1, play: true }, D);
  await rep(D, D1, { position_ms: 70_000, playing: true });
  const tSilent = Date.now();
  const stopped = await sD2.take(isSession((x) => x.playing === false), STALE_MS + 3000);
  ok(!!stopped && Date.now() - tSilent >= STALE_MS - 200, `a playing output that stops REPORTING is presumed gone after the watchdog (${Date.now() - tSilent} ms)`);
  ok(stopped && stopped.data.session.position_ms === 70_000, '…paused at the last position it REPORTED, not a guess past it');
  await sleep(200);
  ok(sD1.ended, "…and its zombie stream is dropped, so presence stops claiming it");
  ok(!!(await sD2.take((e) => e.event === 'devices' && e.data.devices.find((d) => d.id === D1)?.online === false)), '…which every other device hears');

  /* ── Limits ── */
  const Cs = Array.from({ length: 21 }, () => randomUUID());
  for (const id of Cs) await reg(C, id, 'C');
  const cStreams = Cs.slice(0, 20).map((id) => stream(C, id));
  await Promise.all(cStreams.map((s) => s.ready));
  ok(cStreams.every((s) => s.status === 200), '20 streams for one listener open');
  const over21 = stream(C, Cs[20]); await over21.ready;
  ok(over21.status === 429, 'the 21st → 429 (a per-listener cap)');
  for (const s of cStreams) s.close();
  let limited = 0;
  const burst = await Promise.all(Array.from({ length: 80 }, () => reg(C, Cs[0], 'C')));
  for (const r of burst) if (r.status === 429) limited++;
  ok(limited > 0, `a burst of 80 session writes is rate-limited per listener (${limited} × 429)`);
  ok((await reg(A, randomUUID(), 'A still fine')).status === 201, "…and one listener's burst does not limit another");
} catch (err) {
  fail++;
  console.error('  ✗ threw: ' + (err && err.stack || err));
} finally {
  done();
}
