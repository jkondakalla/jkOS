// packages/player/test/gaplessDual.test.mjs — gaplessDual MediaBackend unit test
// (ToDo.md §3 Wave 18, item 18.5).
//
// House pattern (test/backend.test.mjs, .claude/skills/new-tester/SKILL.md §3):
// transpile the REAL src/backend/gaplessDual.ts in-memory (its imports are all
// `import type`, fully erased) and drive the REAL createGaplessDualBackend() against
// two scripted FAKE elements + a fake interval seam — never a re-implementation of
// the logic under test. No DOM.
//
// Coverage map (each is a documented semantic in gaplessDual.ts's header):
//   - plain-seam parity: a consumer that never calls the extension gets htmlMedia
//     behavior (feature detection, active-element command mapping, 'ended' forwards)
//   - preload window arming + standby events never reaching the engine
//   - the gapless swap: ordering (no 'ended'; loadedmetadata THEN the onSwap
//     side-channel), active-role flip, getters tracking the incoming
//   - the ack handshake: load(consumedUrl) adopts (no element reload), one-shot
//   - crossfade ramp math: linear cross-ramp, user-volume ceiling, mid-fade
//     setVolume re-scale, completion cleanup
//   - cancel semantics: pause + real-seek hard-cut, micro-seek keeps the fade
//   - degraded paths: prepareNext invalidation/null, preload error discarded
//   - dispose: symmetric listener removal on BOTH elements, idempotent
//
// Standalone: node "packages/player/test/gaplessDual.test.mjs"  (path has a space —
// quote it). Wired automatically via scripts/run-tests.mjs → `pnpm --filter
// @jkos/player test` → root `pnpm test:contracts`.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');   // packages/player
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-gapless-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

async function importTs(relPath, outName) {
  const src = readFileSync(resolve(root, relPath), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
    fileName: relPath,
  });
  const outFile = join(tmp, outName);
  writeFileSync(outFile, outputText);
  return import(pathToFileURL(outFile).href);
}

check(typeof document === 'undefined', 'precondition: no `document` global in this test run');

const { createGaplessDualBackend, isGaplessBackend, MAX_CROSSFADE_SEC } =
  await importTs('src/backend/gaplessDual.ts', 'gaplessDual.mjs');

// ── Fakes ────────────────────────────────────────────────────────────────────────
// Same MediaElementLike scripting as test/backend.test.mjs, plus a name for
// assertion messages. play() flips `paused` like a real element; events only fire
// when a test fires them.
function createFakeElement(name) {
  const registry = new Map();
  const addCalls = [];
  const removeCalls = [];
  const el = {
    name,
    src: '',
    currentSrc: '',
    currentTime: 0,
    duration: NaN,
    paused: true,
    playbackRate: 1,
    volume: 1,
    muted: false,
    error: null,
    playCalls: 0,
    pauseCalls: 0,
    loadCalls: 0,
    playImpl: null,
    play() {
      el.playCalls++;
      if (typeof el.playImpl === 'function') return el.playImpl();
      el.paused = false;
      return Promise.resolve();
    },
    pause() { el.pauseCalls++; el.paused = true; },
    load() { el.loadCalls++; },
    addEventListener(type, fn) {
      addCalls.push(type);
      if (!registry.has(type)) registry.set(type, new Set());
      registry.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      removeCalls.push(type);
      registry.get(type)?.delete(fn);
    },
    _fire(type, payload) { for (const fn of registry.get(type) ?? []) fn(payload); },
    _listenerCount(type) { return registry.get(type)?.size ?? 0; },
    _addCalls: addCalls,
    _removeCalls: removeCalls,
  };
  return el;
}

// Manual-tick interval seam — the ramp advances only when a test says so.
function fakeTimers() {
  const intervals = new Map();
  let nextId = 1;
  const cleared = [];
  return {
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval(id) { cleared.push(id); intervals.delete(id); },
    _tick() { for (const fn of [...intervals.values()]) fn(); },
    _active() { return intervals.size; },
    _cleared: cleared,
  };
}

/** One fully-wired rig: two fakes, fake timers, an engine-side event log, and a
 *  swap log sharing ONE ordered stream so cross-channel ordering is assertable. */
function rig(opts = {}) {
  const a = createFakeElement('A');
  const b = createFakeElement('B');
  const timers = fakeTimers();
  const backend = createGaplessDualBackend({ elements: [a, b], timers, ...opts });
  const log = [];
  backend.on((ev) => log.push(`evt:${ev.type}`));
  backend.onSwap((info) => log.push(`swap:${info.url}`));
  return { a, b, timers, backend, log, events: () => log.filter((e) => e.startsWith('evt:')) };
}

/* ── default-element guard (no document) ─────────────────────────────────────────── */
{
  let threw = null;
  try { createGaplessDualBackend(); } catch (err) { threw = err; }
  check(threw instanceof Error && /document/.test(threw.message), 'createGaplessDualBackend() with no elements and no `document` throws the guarded error');
}

/* ── feature detection ───────────────────────────────────────────────────────────── */
{
  const { backend } = rig();
  check(isGaplessBackend(backend) === true, 'isGaplessBackend detects the extension on a gaplessDual backend');
  const plainish = { load() {}, play() {}, pause() {}, seek() {}, setRate() {}, setVolume() {}, setMuted() {}, on() {}, dispose() {} };
  check(isGaplessBackend(plainish) === false, 'isGaplessBackend rejects a plain MediaBackend shape (no prepareNext)');
  check(MAX_CROSSFADE_SEC === 12, 'MAX_CROSSFADE_SEC is 12 (ToDo 18.5: crossfade 0–12 s)');
  backend.dispose();
}

/* ── plain-seam parity: no prepareNext → htmlMedia behavior on the active element ── */
{
  const { a, b, backend, events } = rig();

  backend.load({ url: 'https://x/t/1' });
  check(a.src === 'https://x/t/1' && a.loadCalls === 1, 'load() drives the ACTIVE element (src + load())');
  check(b.src === '' && b.loadCalls === 0, 'load() never touches the standby element');

  backend.seek(42.5);
  check(a.currentTime === 42.5, 'seek() sets the active element currentTime');
  backend.setRate(1.75);
  backend.setVolume(0.3);
  backend.setMuted(true);
  check(a.volume === 0.3, 'setVolume outside a fade sets the active element volume');
  check(b.volume === 1, 'setVolume outside a fade leaves the standby volume alone');
  check(a.muted === true && b.muted === true, 'setMuted applies to BOTH elements (mute is a backend-wide gate)');
  check(a.playbackRate === 1.75 && b.playbackRate === 1.75, 'setRate applies to BOTH elements (the preloaded next starts at the user rate)');
  check(backend.rate === 1.75 && backend.volume === 0.3 && backend.muted === true, 'rate/volume/muted getters report the user-facing values');

  await backend.play();
  check(a.playCalls === 1 && a.paused === false, 'play() drives the active element');
  backend.pause();
  check(a.pauseCalls === 1 && a.paused === true, 'pause() drives the active element');

  a.duration = 100;
  a.currentTime = 12;
  check(backend.currentTime === 12 && backend.duration === 100, 'currentTime/duration getters report the ACTIVE element');

  for (const type of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'waiting', 'playing']) a._fire(type);
  check(events().length === 6, 'active-element events forward to the engine stream');
  b._fire('timeupdate'); b._fire('play'); b._fire('playing'); b._fire('pause');
  check(events().length === 6, 'idle standby-element events are swallowed (never reach the engine)');

  a._fire('ended');
  check(events()[6] === 'evt:ended', "'ended' with nothing prepared forwards normally (the engine drives the advance)");

  a.error = { code: 3, message: 'bad codec' };
  a._fire('error');
  const errEvents = events();
  check(errEvents[errEvents.length - 1] === 'evt:error', 'an ACTIVE-element error forwards, classified');

  backend.dispose();
}

/* ── preload window arming ───────────────────────────────────────────────────────── */
{
  const { a, b, backend, events } = rig();
  backend.load({ url: 'u1' });
  a.duration = 100;
  backend.prepareNext('u2');

  a.currentTime = 80;   // remaining 20 > 15 — outside the window
  a._fire('timeupdate');
  check(b.src === '' && b.loadCalls === 0, 'prepareNext alone does not preload outside the ~15 s window');

  a.currentTime = 86;   // remaining 14 <= 15 — inside
  a._fire('timeupdate');
  check(b.src === 'u2' && b.loadCalls === 1, 'inside the window the standby element preloads the prepared url');

  a.currentTime = 90;
  a._fire('timeupdate');
  check(b.loadCalls === 1, 'the preload arms exactly once (no re-load every timeupdate)');

  const before = events().length;
  b._fire('loadedmetadata');
  check(events().length === before, "the standby's preload 'loadedmetadata' is swallowed (marks readiness internally only)");

  backend.dispose();
}

/* ── the gapless swap (crossfade 0): ordering, role flip, ack adoption ───────────── */
{
  const { a, b, backend, log, events } = rig();
  backend.load({ url: 'u1' });
  backend.setVolume(0.9);
  backend.setRate(1.25);
  a.duration = 100;
  await backend.play();
  backend.prepareNext('u2');
  a.currentTime = 86;
  a._fire('timeupdate');
  b._fire('loadedmetadata');   // preload ready
  b.duration = 200;

  const mark = log.length;
  a._fire('ended');            // the boundary

  const tail = log.slice(mark);
  check(!tail.includes('evt:ended'), "a swap consumes the boundary: NO 'ended' reaches the engine");
  check(tail[0] === 'evt:loadedmetadata', "the swap's first engine-facing event is 'loadedmetadata' (an instant load of the next source)");
  check(tail[1] === 'swap:u2', 'the onSwap side-channel fires AFTER the engine-facing swap events, carrying the consumed url');
  check(b.playCalls === 1 && b.paused === false, 'the incoming element starts at the exact ended boundary');
  check(b.volume === 0.9, 'gapless swap starts the incoming at the full user-volume ceiling');
  check(b.playbackRate === 1.25, 'the incoming element starts at the user rate');
  check(a.src === '' && a.paused === true, 'the outgoing element is paused and cleared at a gapless swap');
  b.currentTime = 0.5;
  check(backend.currentTime === 0.5 && backend.duration === 200, 'getters report the INCOMING element after the flip');

  b._fire('play');
  check(events()[events().length - 1] === 'evt:play', "the incoming element's own events forward now that it is active");
  a._fire('timeupdate');
  check(events()[events().length - 1] === 'evt:play', 'post-swap events from the OUTGOING element are swallowed');

  // The ack handshake: the engine (round-tripped via the adapter) reloads the url
  // the swap consumed — the backend adopts, never element-reloads.
  const evBefore = events().length;
  const loadsBefore = b.loadCalls;   // 1 — the preload's own load()
  backend.load({ url: 'u2' });
  check(b.loadCalls === loadsBefore, 'load(consumedUrl) adopts the already-playing element — NO element reload (no reintroduced gap)');
  check(events().length === evBefore, 'the ack fires nothing synchronously (seam contract)');
  await Promise.resolve();
  check(events()[events().length - 1] === 'evt:loadedmetadata' && events().length === evBefore + 1, "the ack answers with one async 'loadedmetadata' so the engine's load choreography completes");

  // One-shot: the SAME url loaded again without a new swap is a real load.
  backend.load({ url: 'u2' });
  check(b.loadCalls === loadsBefore + 1, 'the ack is one-shot — a second load of the same url is a REAL element load');

  backend.dispose();
}

/* ── crossfade: ramp math, ceiling, mid-fade setVolume, completion ──────────────── */
{
  const { a, b, timers, backend, log } = rig({ crossfadeSec: 4 });
  check(backend.crossfadeSec === 4, 'opts.crossfadeSec initializes the knob');
  backend.load({ url: 'u1' });
  backend.setVolume(0.8);
  a.duration = 100;
  await backend.play();
  backend.prepareNext('u2');
  a.currentTime = 86;
  a._fire('timeupdate');
  b._fire('loadedmetadata');
  b.duration = 180;

  a.currentTime = 95;   // remaining 5 > 4 — not yet
  a._fire('timeupdate');
  check(b.playCalls === 0, 'no fade before remaining <= crossfadeSec');

  const mark = log.length;
  a.currentTime = 97;   // remaining 3 <= 4 — fade begins (swap commits NOW)
  b.currentTime = 0;
  a._fire('timeupdate');
  check(b.playCalls === 1 && b.paused === false, 'the fade starts the incoming element crossfadeSec before the end');
  check(a.paused === false, 'the outgoing keeps playing under the ramp');
  check(approx(b.volume, 0) && approx(a.volume, 0.8), 'ramp start: incoming at 0, outgoing at the user ceiling');
  check(log.slice(mark).includes('swap:u2') && !log.slice(mark).includes('evt:ended'), 'the crossfade commit IS the swap (side-channel fired, no ended)');
  check(timers._active() === 1, 'the ramp timer is running');
  check(backend.currentTime === b.currentTime, 'getters flip to the incoming at fade START (active-by-cursor)');

  b.currentTime = 1;    // p = 1/4
  timers._tick();
  check(approx(b.volume, 0.2) && approx(a.volume, 0.6), 'linear ramp at p=0.25: incoming user·p, outgoing user·(1−p)');

  b.currentTime = 2;    // p = 1/2
  timers._tick();
  check(approx(b.volume, 0.4) && approx(a.volume, 0.4), 'linear ramp at p=0.5: equal legs');

  backend.setVolume(0.5);   // mid-fade ceiling change re-scales BOTH legs
  check(approx(b.volume, 0.25) && approx(a.volume, 0.25), 'mid-fade setVolume re-scales both legs under the new ceiling (no jump to full)');
  check(backend.volume === 0.5, 'the volume getter reports the user ceiling, not a mid-ramp element volume');

  b.currentTime = 4;    // p = 1 — done
  timers._tick();
  check(timers._active() === 0 && timers._cleared.length === 1, 'ramp completion clears the timer');
  check(a.paused === true && a.src === '', 'ramp completion pauses + clears the outgoing');
  check(approx(b.volume, 0.5), 'ramp completion lands the incoming exactly on the user ceiling');

  backend.dispose();
}

/* ── mid-fade cancel semantics: micro-seek keeps, real seek + pause hard-cut ─────── */
{
  // Build a running fade, then exercise the engine's post-ack seek(0) tolerance.
  const { a, b, timers, backend } = rig({ crossfadeSec: 4 });
  backend.load({ url: 'u1' });
  backend.setVolume(0.8);
  a.duration = 100;
  await backend.play();
  backend.prepareNext('u2');
  a.currentTime = 86; a._fire('timeupdate');
  b._fire('loadedmetadata'); b.duration = 180;
  a.currentTime = 97; b.currentTime = 0; a._fire('timeupdate');   // fade running

  backend.load({ url: 'u2' });   // the adapter round-trip's ack lands mid-fade
  await Promise.resolve();
  b.currentTime = 0.02;
  backend.seek(0);               // the engine's bookkeeping seek after the ack
  check(timers._active() === 1, "the engine's post-ack seek(0) is a micro-seek — the fade survives");
  check(b.currentTime === 0, 'the micro-seek still applies to the active element');

  b.currentTime = 1; timers._tick();
  backend.seek(50);              // a REAL user jump
  check(timers._active() === 0, 'a real seek (>= 0.5 s delta) hard-cuts the fade');
  check(a.paused === true && a.src === '', 'hard-cut silences + clears the outgoing');
  check(approx(b.volume, 0.8), 'hard-cut restores the incoming to the user ceiling');
  check(b.currentTime === 50, 'the seek then applies to the active-by-cursor element');
  backend.dispose();
}
{
  // pause() mid-fade: hard-cut to the incoming, then pause it.
  const { a, b, timers, backend } = rig({ crossfadeSec: 4 });
  backend.load({ url: 'u1' });
  a.duration = 100;
  await backend.play();
  backend.prepareNext('u2');
  a.currentTime = 86; a._fire('timeupdate');
  b._fire('loadedmetadata');
  a.currentTime = 97; b.currentTime = 0; a._fire('timeupdate');
  b.currentTime = 1; timers._tick();

  backend.pause();
  check(timers._active() === 0, 'pause() mid-fade cancels the ramp');
  check(a.src === '' && a.paused === true, 'pause() mid-fade silences + clears the outgoing (hard-cut to the incoming)');
  check(approx(b.volume, 1), 'pause() mid-fade restores the incoming to the user ceiling');
  check(b.pauseCalls === 1 && b.paused === true, 'pause() then pauses the ACTIVE (incoming) element');
  backend.dispose();
}
{
  // The outgoing reaching its own natural end mid-ramp settles the fade early.
  const { a, b, timers, backend } = rig({ crossfadeSec: 4 });
  backend.load({ url: 'u1' });
  a.duration = 100;
  await backend.play();
  backend.prepareNext('u2');
  a.currentTime = 86; a._fire('timeupdate');
  b._fire('loadedmetadata');
  a.currentTime = 97; b.currentTime = 0; a._fire('timeupdate');
  a._fire('ended');   // the outgoing's own end, mid-ramp — swallowed, settles the fade
  check(timers._active() === 0, "the outgoing's natural 'ended' mid-ramp settles the fade");
  check(a.src === '' && approx(b.volume, 1), 'early settle cleans the outgoing and lands the ceiling');
  backend.dispose();
}

/* ── prepareNext invalidation + degraded paths ───────────────────────────────────── */
{
  const { a, b, backend, events } = rig();
  backend.load({ url: 'u1' });
  a.duration = 100;
  backend.prepareNext('u2');
  a.currentTime = 90; a._fire('timeupdate');
  check(b.src === 'u2', 'preload armed for u2');

  backend.prepareNext('u3');   // the queue changed under the preload
  check(b.src === '' && b.pauseCalls >= 1, 'prepareNext(differentUrl) discards the stale preload');
  a._fire('timeupdate');
  check(b.src === 'u3' && b.loadCalls === 2, 'the next timeupdate re-arms the preload for the new url');

  backend.prepareNext(null);   // nothing follows anymore (queue exhausted / repeat-one)
  check(b.src === '', 'prepareNext(null) clears the preparation');
  a._fire('timeupdate');
  check(b.loadCalls === 2, 'nothing re-arms after prepareNext(null)');

  a._fire('ended');
  check(events()[events().length - 1] === 'evt:ended', "'ended' with nothing prepared forwards — the engine-driven advance is the fallback");
  backend.dispose();
}
{
  // Preload not READY at the boundary (slow network) → degrade, don't half-swap.
  const { a, b, backend, events } = rig();
  backend.load({ url: 'u1' });
  a.duration = 100;
  backend.prepareNext('u2');
  a.currentTime = 90; a._fire('timeupdate');
  check(b.src === 'u2', 'preload started');
  a._fire('ended');   // metadata never arrived
  check(events()[events().length - 1] === 'evt:ended', "an unready preload at 'ended' forwards the end (a gap beats a broken swap)");
  check(b.playCalls === 0, 'the unready standby is never started');
  backend.dispose();
}
{
  // A preload error is discarded silently — the active track is unaffected.
  const { a, b, backend, events } = rig();
  backend.load({ url: 'u1' });
  a.duration = 100;
  backend.prepareNext('u2');
  a.currentTime = 90; a._fire('timeupdate');
  const before = events().length;
  b.error = { code: 2, message: 'network died' };
  b._fire('error');
  check(events().length === before, "a standby preload 'error' NEVER reaches the engine");
  check(b.src === '', 'the failed preload is discarded');
  a._fire('ended');
  check(events()[events().length - 1] === 'evt:ended', 'the boundary then degrades to the engine-driven advance');
  backend.dispose();
}
{
  // A real load() resets ALL preparation (the adapter re-prepares from its queue).
  const { a, b, backend } = rig();
  backend.load({ url: 'u1' });
  a.duration = 100;
  backend.prepareNext('u2');
  a.currentTime = 90; a._fire('timeupdate');
  backend.load({ url: 'u9' });   // prev/track-change — a real load
  check(a.src === 'u9' && a.loadCalls === 2, 'a real load re-points the ACTIVE element');
  check(b.src === '', 'a real load discards the standby preload');
  a._fire('timeupdate');
  check(b.loadCalls === 1, 'a real load also clears pendingNext — nothing re-arms until the adapter re-prepares');
  backend.dispose();
}

/* ── crossfadeSec clamp + onSwap unsubscribe ─────────────────────────────────────── */
{
  const { backend } = rig({ crossfadeSec: 99 });
  check(backend.crossfadeSec === 12, 'opts.crossfadeSec clamps to MAX_CROSSFADE_SEC');
  backend.crossfadeSec = -3;
  check(backend.crossfadeSec === 0, 'the setter clamps below 0');
  backend.crossfadeSec = NaN;
  check(backend.crossfadeSec === 0, 'a non-finite crossfadeSec clamps to 0 (gapless)');
  backend.crossfadeSec = 6.5;
  check(backend.crossfadeSec === 6.5, 'an in-range crossfadeSec passes through');
  backend.dispose();
}
{
  const { a, b, backend } = rig();
  const seen = [];
  const unsub = backend.onSwap((info) => seen.push(info.url));
  unsub();
  backend.load({ url: 'u1' });
  a.duration = 100;
  backend.prepareNext('u2');
  a.currentTime = 90; a._fire('timeupdate');
  b._fire('loadedmetadata');
  a._fire('ended');
  check(seen.length === 0 && b.playCalls === 1, 'onSwap unsubscribe stops delivery (the swap itself still happens)');
  backend.dispose();
}

/* ── dispose: both elements, symmetric, idempotent, ramp cleared ─────────────────── */
{
  const { a, b, timers, backend } = rig({ crossfadeSec: 4 });
  check(a._addCalls.length === 8 && b._addCalls.length === 8, 'construction wires 8 listeners on EACH element');

  backend.load({ url: 'u1' });
  a.duration = 100;
  await backend.play();
  backend.prepareNext('u2');
  a.currentTime = 86; a._fire('timeupdate');
  b._fire('loadedmetadata');
  a.currentTime = 97; a._fire('timeupdate');   // fade running

  backend.dispose();
  check(timers._active() === 0, 'dispose() cancels a running ramp');
  check(a._removeCalls.length === 8 && b._removeCalls.length === 8, 'dispose() removes all 8 listeners from EACH element');
  check(
    JSON.stringify([...a._addCalls].sort()) === JSON.stringify([...a._removeCalls].sort()) &&
    JSON.stringify([...b._addCalls].sort()) === JSON.stringify([...b._removeCalls].sort()),
    'added and removed listener types match exactly per element',
  );
  check(a.src === '' && b.src === '' && a.paused && b.paused, 'dispose() pauses + clears BOTH elements');

  const aPauses = a.pauseCalls;
  backend.dispose();
  check(a._removeCalls.length === 8 && a.pauseCalls === aPauses, 'a second dispose() is a no-op (idempotent)');
}

/* ── summary ─────────────────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n✗ gaplessDual: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ gaplessDual: all assertions passed');
