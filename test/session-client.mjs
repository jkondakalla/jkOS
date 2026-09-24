// session-client.mjs — the pure logic under KourOS's listening-session client
// (apps/kouros/src/session/): the SSE framing, the reconnect backoff, the server
// clock and the position a REMOTE device shows, the one "what is this tab?"
// decision, and the default device name.
//
// ⚠️ WHY THIS GATE EXISTS. Every one of these fails SILENTLY, and on another device:
//   · a parser that ends an event at a CRLF split across two chunks drops or mangles
//     the `session` event it was carrying, and the remote simply stays a rev behind;
//   · an extrapolation that runs a paused session, runs backwards on a clock behind
//     the report, or runs past the item's end shows a scrubber that is confidently
//     wrong while the audio is fine;
//   · a mode decision that calls "this device is the output but another of its tabs
//     plays it" LOCAL has two tabs playing the same song a beat apart;
//   · a device naming that reads Edge as Chrome, or an iPad (which calls itself
//     "Macintosh") as a desktop, lists the wrong thing in the picker.
// None of these throw. The modules are pure by construction (no imports that are not
// types), transpiled in-memory with the repo's own `typescript`, and the REAL
// functions are driven — the house pattern (test/cards-logic.mjs).
//
// Run:  node test/session-client.mjs   (wired as `pnpm check:session`, folded into
//                                        `pnpm test:contracts`).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-session-client-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

async function importTs(relPath, outName) {
  const src = readFileSync(resolve(root, relPath), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    fileName: relPath,
  });
  const outFile = join(tmp, outName);
  writeFileSync(outFile, outputText);
  return import(pathToFileURL(outFile).href);
}

const S = 'apps/kouros/src/session/';
const sse = await importTs(`${S}sse.ts`, 'sse.mjs');
const clock = await importTs(`${S}clock.ts`, 'clock.mjs');
const route = await importTs(`${S}route.ts`, 'route.mjs');
const device = await importTs(`${S}device.ts`, 'device.mjs');

/* ── 1. The SSE framing ──────────────────────────────────────────────────────── */
{
  const { parseSse } = sse;
  const one = parseSse('event: session\ndata: {"rev":3}\n\n');
  check(one.events.length === 1 && one.events[0].event === 'session' && one.events[0].data === '{"rev":3}' && one.rest === '',
    'one whole event parses, nothing left over');
  check(parseSse(': ping\n\n').events.length === 0, 'a comment (the keep-alive ping) is not an event');
  check(parseSse('event: devices\n\n').events.length === 0, 'an event with no data is not dispatched');
  const multi = parseSse('data: a\ndata: b\n\n');
  check(multi.events[0].data === 'a\nb' && multi.events[0].event === 'message', 'data lines join with \\n; unnamed is "message"');
  check(parseSse('data:tight\n\n').events[0].data === 'tight', 'the space after the colon is optional');

  // Fed one character at a time — how a slow network really delivers it.
  const wire = 'event: hello\ndata: {"a":1}\n\n: ping\n\nevent: command\ndata: {"op":"pause"}\n\n';
  let buf = ''; const got = [];
  for (const ch of wire) { const r = parseSse(buf + ch); got.push(...r.events); buf = r.rest; }
  check(got.length === 2 && got[0].event === 'hello' && got[1].event === 'command' && JSON.parse(got[1].data).op === 'pause',
    'an event split across any chunk boundary arrives whole, once');

  // ⚠️ The CRLF split: chunk one ends on '\r', chunk two starts '\n'.
  const a = parseSse('event: session\r\ndata: {"rev":9}\r\n\r');
  const b = parseSse(a.rest + '\nevent: devices\r\ndata: []\r\n\r\n');
  const all = [...a.events, ...b.events];
  check(all.length === 2 && all[0].event === 'session' && all[0].data === '{"rev":9}' && all[1].event === 'devices',
    'a CRLF split between chunks is neither a phantom blank line nor a lost event');
  // The split that does the damage is MID-event: without the hold-back, the '\r' and
  // the next chunk's '\n' read as a blank line, and one two-line event becomes two.
  const m1 = parseSse('event: session\r\ndata: a\r');
  const m2 = parseSse(m1.rest + '\ndata: b\r\n\r\n');
  const mid = [...m1.events, ...m2.events];
  check(mid.length === 1 && mid[0].event === 'session' && mid[0].data === 'a\nb', 'a CRLF split MID-event does not cut the event in two');
  const lone = parseSse('data: x\r');
  check(lone.events.length === 0 && lone.rest.endsWith('\r'), 'a trailing \\r is held back for the next chunk');
}

/* ── 2. Reconnect backoff ────────────────────────────────────────────────────── */
{
  const { backoffMs } = sse;
  const mid = () => 0.5;
  check(backoffMs(0, mid) === 3000 && backoffMs(1, mid) === 6000 && backoffMs(2, mid) === 12000, 'backoff doubles from 3 s');
  check(backoffMs(10, mid) === 30000 && backoffMs(50, mid) === 30000, '…to a 30 s ceiling');
  check(backoffMs(0, () => 0) === 2400 && backoffMs(0, () => 1) === 3600, '±20 % jitter, so a restart does not reconnect every device in one instant');
}

/* ── 3. The server clock, and where a remote's music has got to ─────────────── */
{
  const { sampleClock, betterClock, extrapolateMs, sleepRemainingMs } = clock;
  const iso = (ms) => new Date(ms).toISOString();
  const T = Date.parse('2026-09-24T12:00:00.000Z');

  const c = sampleClock(T, T + 200, iso(T + 5100));
  check(c && c.rttMs === 200 && c.offsetMs === 5000, 'the offset is the server time less the round trip\'s midpoint');
  check(sampleClock(T, T - 1, iso(T)) === null && sampleClock(T, T + 1, 'not a date') === null, 'an impossible sample is none at all');
  const slow = { offsetMs: 900, rttMs: 800 }, fast = { offsetMs: 1000, rttMs: 40 };
  check(betterClock(slow, fast) === fast && betterClock(fast, slow) === fast && betterClock(null, slow) === slow,
    'the shorter round trip wins');

  const s = { position_ms: 60_000, playing: true, rate: 1.5, reported_at: iso(T) };
  check(extrapolateMs(s, T + 4000) === 66_000, 'playing: the position moves at the rate from the report');
  check(extrapolateMs({ ...s, playing: false }, T + 4000) === 60_000, 'paused: it holds still');
  check(extrapolateMs(s, T - 9000) === 60_000, 'a clock behind the report never runs it backwards');
  check(extrapolateMs(s, T + 600_000, 90_000) === 90_000, 'a known duration caps it — a vanished output\'s remote does not scrub past the end');
  check(extrapolateMs({ ...s, reported_at: null }, T + 4000) === 60_000, 'no report time: nothing to extrapolate from');

  const sl = { sleep_remaining_ms: 600_000, playing: true, reported_at: iso(T) };
  check(sleepRemainingMs(sl, T + 60_000) === 540_000, 'a sleep timer counts DOWN from the report while playing');
  check(sleepRemainingMs({ ...sl, playing: false }, T + 60_000) === 600_000, '…and holds while paused');
  check(sleepRemainingMs(sl, T + 9e6) === 0, '…never below zero');
  check(sleepRemainingMs({ ...sl, sleep_remaining_ms: null }, T) === null, 'no timer (or end-of-chapter) has no remaining time');
}

/* ── 4. What is THIS tab? ────────────────────────────────────────────────────── */
{
  const { modeOf } = route;
  const ME = 'me', OTHER = 'other';
  const base = { available: true, active: null, me: ME, activeOnline: false, holdsLock: false, lockElsewhere: false };
  check(modeOf({ ...base, available: false, active: ME, holdsLock: true }) === 'solo', 'no session reachable: solo, whatever else is true');
  check(modeOf(base) === 'idle', 'no output: idle');
  check(modeOf({ ...base, active: ME, holdsLock: true }) === 'local', 'this device is the output and this tab holds the lock: local');
  check(modeOf({ ...base, active: ME, lockElsewhere: true }) === 'remote',
    'this device is the output but ANOTHER of its tabs plays it: remote, not a second copy');
  check(modeOf({ ...base, active: ME }) === 'idle', 'this device is the output and no tab of it plays (a reload): idle');
  check(modeOf({ ...base, active: OTHER, activeOnline: true }) === 'remote', 'another device is the output and online: remote');
  check(modeOf({ ...base, active: OTHER, activeOnline: false }) === 'idle', 'another device was the output and is gone: idle');
  check(modeOf({ ...base, active: OTHER, activeOnline: true, holdsLock: true }) === 'remote',
    'holding the lock does not make a tab the output — the session does');
}

/* ── 5. The default device name and kind ─────────────────────────────────────── */
{
  const { defaultDeviceName, deviceKind, browserName } = device;
  const UA = {
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  };
  check(defaultDeviceName(UA.androidPhone) === 'Chrome on Android' && deviceKind(UA.androidPhone) === 'phone', 'Chrome on an Android phone');
  check(deviceKind(UA.androidTablet) === 'tablet', 'an Android browser with no "Mobile" is a tablet');
  check(defaultDeviceName(UA.iphone) === 'Safari on iPhone' && deviceKind(UA.iphone) === 'phone', 'Safari on iPhone');
  check(defaultDeviceName(UA.ipadAsMac, true) === 'Safari on iPad' && deviceKind(UA.ipadAsMac, true) === 'tablet',
    'an iPad that says "Macintosh" is told apart by its touch screen');
  check(defaultDeviceName(UA.ipadAsMac, false) === 'Safari on Mac' && deviceKind(UA.ipadAsMac, false) === 'desktop', '…and a Mac is still a Mac');
  check(browserName(UA.edge) === 'Edge' && defaultDeviceName(UA.edge) === 'Edge on Windows', 'Edge, though its UA also says Chrome');
  check(defaultDeviceName(UA.firefoxLinux) === 'Firefox on Linux', 'Firefox on Linux');
  check(browserName(UA.samsung) === 'Samsung Internet', 'Samsung Internet, though its UA also says Chrome');
  check(defaultDeviceName('x'.repeat(200)).length <= 60, 'a default name fits the server\'s 60-character limit');
}

console.log(failed ? `\nsession-client: ${failed} FAILED` : '\nsession-client: all passed');
process.exit(failed ? 1 : 0);
