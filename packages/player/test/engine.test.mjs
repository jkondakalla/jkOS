// packages/player/test/engine.test.mjs — unit tests for the PURE pieces the headless
// engine (Wave 15, item 15.3) factors out of usePlayerEngine.ts:
//   1. rate.ts       — the persisted-rate read/write (given an injected StorageLike) +
//                      the preset-cycle math (RATE_PRESETS / nextRate).
//   2. recovery.ts   — the compat-ladder DECISIONS (recoverable-kind test, escalation
//                      bounds, next rung, effective-start-rung, the cache key).
//   3. volume.ts     — Wave 16.2's volume/mute read/persist/clamp + the apply-to-
//                      backend mechanism (driven against a scripted fake backend).
//
// The hook itself is a stateful React hook with a MediaBackend and network seams; its
// full behavior is proven by item 15.4's PapyrOS migration + the wave gate, NOT by a
// jsdom harness (the repo has none). So this covers exactly the self-contained logic —
// the house pattern (transpile the real .ts in-memory, import the REAL functions, drive
// them; copied from test/core.test.mjs + test/cards-logic.mjs). All three modules are
// self-contained: recovery.ts has no imports; volume.ts's imports are type-only
// (erased by the transpile); rate.ts's only global reference
// (localStorage) is `??`-guarded and never reached when a store is passed.
//
// Run:  node "packages/player/test/engine.test.mjs"   (wired via scripts/run-tests.mjs
//       → `pnpm --filter @jkos/player test` → root `pnpm test:contracts`).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-engine-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

const rate = await importTs('src/engine/rate.ts', 'rate.mjs');
const recovery = await importTs('src/engine/recovery.ts', 'recovery.mjs');
const volume = await importTs('src/engine/volume.ts', 'volume.mjs');

// A scripted StorageLike (never the global localStorage — this run has no DOM).
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    _map: map,
  };
}

/* ══════════════════════════════════════════════════════════════════════ *
 * rate.ts
 * ══════════════════════════════════════════════════════════════════════ */
const { RATE_PRESETS, readPersistedRate, persistRate, nextRate } = rate;

check(deepEq([...RATE_PRESETS], [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]), 'RATE_PRESETS is the 7 canonical presets in cycle order');

/* ── readPersistedRate ─────────────────────────────────────────────────── */
check(readPersistedRate('k', fakeStore({ k: '1.5' })) === 1.5, 'readPersistedRate returns a stored preset value');
check(readPersistedRate('k', fakeStore({ k: '2.5' })) === 2.5, 'readPersistedRate returns the top preset');
check(readPersistedRate('k', fakeStore({ k: '1.1' })) === 1, 'readPersistedRate defaults a non-preset value to 1');
check(readPersistedRate('k', fakeStore({})) === 1, 'readPersistedRate defaults a missing key to 1');
check(readPersistedRate('k', fakeStore({ k: 'abc' })) === 1, 'readPersistedRate defaults a non-numeric value (NaN) to 1');
check(readPersistedRate('k', fakeStore({ k: '0.75' })) === 0.75, 'readPersistedRate honors the lowest preset (0.75)');
{
  const throwing = { getItem() { throw new Error('private mode'); }, setItem() {} };
  check(readPersistedRate('k', throwing) === 1, 'readPersistedRate returns 1 when the store throws (private mode)');
}

/* ── persistRate ───────────────────────────────────────────────────────── */
{
  const s = fakeStore();
  persistRate('papyros.player.rate', 1.75, s);
  check(s._map.get('papyros.player.rate') === '1.75', 'persistRate writes String(rate) under the given key');
}
{
  const throwing = { getItem() { return null; }, setItem() { throw new Error('private mode'); } };
  let threw = false;
  try { persistRate('k', 1.5, throwing); } catch { threw = true; }
  check(threw === false, 'persistRate swallows a throwing store (private mode) — never throws');
}

/* ── nextRate (cycle) ──────────────────────────────────────────────────── */
check(nextRate(1) === 1.25, 'nextRate advances 1 → 1.25');
check(nextRate(0.75) === 1, 'nextRate advances the first preset');
check(nextRate(2.5) === 0.75, 'nextRate wraps the last preset back to the first');
check(nextRate(3) === 0.75, 'nextRate on an unknown rate (indexOf -1) wraps to the first preset');
{
  // Cycling through all 7 presets returns to the start.
  let r = 1;
  const seen = [r];
  for (let i = 0; i < 7; i++) { r = nextRate(r); seen.push(r); }
  check(seen[7] === 1, 'nextRate returns to the start after a full 7-step cycle');
  check(new Set(seen.slice(0, 7)).size === 7, 'a full cycle visits every distinct preset exactly once');
}

/* ══════════════════════════════════════════════════════════════════════ *
 * recovery.ts — the compat-ladder decisions
 * ══════════════════════════════════════════════════════════════════════ */
const {
  DEFAULT_RECOVERABLE_KINDS, compatKey, isRecoverableKind, canEscalate,
  nextCompatLevel, effectiveStartLevel,
} = recovery;

/* ── compatKey ─────────────────────────────────────────────────────────── */
check(compatKey(5, 2) === '5:2', 'compatKey formats a numeric item id');
check(compatKey('abc', 0) === 'abc:0', 'compatKey formats a string item id (generalized beyond papyros numbers)');

/* ── isRecoverableKind ─────────────────────────────────────────────────── */
check(deepEq([...DEFAULT_RECOVERABLE_KINDS], ['decode', 'src-unsupported']), 'DEFAULT_RECOVERABLE_KINDS is decode + src-unsupported (was MediaError code 3/4)');
check(isRecoverableKind('decode', DEFAULT_RECOVERABLE_KINDS) === true, "isRecoverableKind('decode') arms the ladder");
check(isRecoverableKind('src-unsupported', DEFAULT_RECOVERABLE_KINDS) === true, "isRecoverableKind('src-unsupported') arms the ladder");
check(isRecoverableKind('network', DEFAULT_RECOVERABLE_KINDS) === false, "isRecoverableKind('network') does NOT arm the ladder");
check(isRecoverableKind('aborted', DEFAULT_RECOVERABLE_KINDS) === false, "isRecoverableKind('aborted') does NOT arm the ladder");
check(isRecoverableKind('autoplay-blocked', DEFAULT_RECOVERABLE_KINDS) === false, "isRecoverableKind('autoplay-blocked') does NOT arm the ladder");

/* ── canEscalate (ladder bound: original `level >= 2` → give up) ────────── */
check(canEscalate(0, 2) === true, 'canEscalate at rung 0 (maxLevel 2) → true');
check(canEscalate(1, 2) === true, 'canEscalate at rung 1 (maxLevel 2) → true');
check(canEscalate(2, 2) === false, 'canEscalate at rung 2 (maxLevel 2) → false (ladder exhausted)');
check(canEscalate(3, 2) === false, 'canEscalate past maxLevel → false');

/* ── nextCompatLevel ───────────────────────────────────────────────────── */
check(nextCompatLevel(0) === 1, 'nextCompatLevel 0 → 1 (remux rung)');
check(nextCompatLevel(1) === 2, 'nextCompatLevel 1 → 2 (re-encode rung)');

/* ── effectiveStartLevel (session bump wins over source initial) ───────── */
check(effectiveStartLevel(0, 1) === 1, 'effectiveStartLevel: source initial rung wins when no session bump');
check(effectiveStartLevel(2, 1) === 2, 'effectiveStartLevel: a session bump (this-session failure) wins over the initial rung');
check(effectiveStartLevel(0, 0) === 0, 'effectiveStartLevel: both 0 → plain source (level 0)');
check(effectiveStartLevel(1, 0) === 1, 'effectiveStartLevel: a session bump with no initial rung still applies');

/* ══════════════════════════════════════════════════════════════════════ *
 * volume.ts — Wave 16.2 volume/mute persistence + apply mechanism
 * ══════════════════════════════════════════════════════════════════════ */
const {
  DEFAULT_VOLUME, DEFAULT_MUTED, clampVolume,
  readPersistedVolume, persistVolume, readPersistedMuted, persistMuted,
  readInitialVolume, readInitialMuted, applyVolume, applyMuted,
} = volume;

// A scripted backend covering exactly the surface applyVolume/applyMuted drive
// (mirrors test/backend.test.mjs's fake-element approach: real code, fake seam).
function fakeBackend() {
  const calls = { setVolume: [], setMuted: [] };
  return {
    setVolume: (v) => calls.setVolume.push(v),
    setMuted: (m) => calls.setMuted.push(m),
    _calls: calls,
  };
}

check(DEFAULT_VOLUME === 1 && DEFAULT_MUTED === false, 'defaults are volume 1 / unmuted');

/* ── clampVolume ───────────────────────────────────────────────────────── */
check(clampVolume(0.5) === 0.5, 'clampVolume passes an in-range value through');
check(clampVolume(1.5) === 1, 'clampVolume clamps above-range to 1');
check(clampVolume(-0.2) === 0, 'clampVolume clamps below-range to 0');
check(clampVolume(0) === 0 && clampVolume(1) === 1, 'clampVolume keeps the exact bounds 0 and 1');
check(clampVolume(NaN) === 1, 'clampVolume defaults a non-finite input (NaN) to 1');
check(clampVolume(Infinity) === 1, 'clampVolume defaults Infinity to 1');

/* ── readPersistedVolume ───────────────────────────────────────────────── */
check(readPersistedVolume('v', fakeStore({ v: '0.4' })) === 0.4, 'readPersistedVolume restores a stored value');
check(readPersistedVolume('v', fakeStore({ v: '2' })) === 1, 'readPersistedVolume clamps a stored out-of-range value');
check(readPersistedVolume('v', fakeStore({ v: '-1' })) === 0, 'readPersistedVolume clamps a stored negative value to 0');
check(readPersistedVolume('v', fakeStore({})) === 1, 'readPersistedVolume defaults a missing key to 1');
check(readPersistedVolume('v', fakeStore({ v: 'abc' })) === 1, 'readPersistedVolume defaults a non-numeric value (NaN) to 1');
check(readPersistedVolume('v', fakeStore({ v: '0' })) === 0, "readPersistedVolume honors a stored '0' (silent, NOT the default)");
{
  const throwing = { getItem() { throw new Error('private mode'); }, setItem() {} };
  check(readPersistedVolume('v', throwing) === 1, 'readPersistedVolume returns 1 when the store throws (private mode)');
}

/* ── persistVolume ─────────────────────────────────────────────────────── */
{
  const s = fakeStore();
  persistVolume('papyros.player.volume', 0.6, s);
  check(s._map.get('papyros.player.volume') === '0.6', 'persistVolume writes String(volume) under the given key');
  persistVolume('papyros.player.volume', 3, s);
  check(s._map.get('papyros.player.volume') === '1', 'persistVolume clamps before writing');
}
{
  const throwing = { getItem() { return null; }, setItem() { throw new Error('private mode'); } };
  let threw = false;
  try { persistVolume('v', 0.5, throwing); } catch { threw = true; }
  check(threw === false, 'persistVolume swallows a throwing store (private mode) — never throws');
}

/* ── readPersistedMuted / persistMuted (under `<key>.muted`) ───────────── */
{
  const s = fakeStore();
  persistMuted('papyros.player.volume', true, s);
  check(s._map.get('papyros.player.volume.muted') === '1', "persistMuted writes '1' under `<key>.muted`");
  check(readPersistedMuted('papyros.player.volume', s) === true, 'readPersistedMuted round-trips true');
  persistMuted('papyros.player.volume', false, s);
  check(s._map.get('papyros.player.volume.muted') === '0', "persistMuted writes '0' for unmuted");
  check(readPersistedMuted('papyros.player.volume', s) === false, 'readPersistedMuted round-trips false');
}
check(readPersistedMuted('v', fakeStore({})) === false, 'readPersistedMuted defaults a missing key to false');
check(readPersistedMuted('v', fakeStore({ 'v.muted': 'garbage' })) === false, 'readPersistedMuted treats a non-flag value as unmuted');
{
  const throwing = { getItem() { throw new Error('private mode'); }, setItem() {} };
  check(readPersistedMuted('v', throwing) === false, 'readPersistedMuted returns false when the store throws');
}

/* ── readInitialVolume / readInitialMuted (session-only vs restored) ───── */
check(readInitialVolume('v', fakeStore({ v: '0.25' })) === 0.25, 'readInitialVolume with a key restores the persisted value');
check(readInitialMuted('v', fakeStore({ 'v.muted': '1' })) === true, 'readInitialMuted with a key restores the persisted flag');
{
  // No key configured → defaults, and the store is NEVER consulted.
  const untouchable = { getItem() { throw new Error('must not be read'); }, setItem() { throw new Error('must not be written'); } };
  check(readInitialVolume(undefined, untouchable) === 1, 'readInitialVolume with no key returns the default without touching the store');
  check(readInitialMuted(undefined, untouchable) === false, 'readInitialMuted with no key returns the default without touching the store');
}

/* ── applyVolume (the engine's setVolume mechanism) ────────────────────── */
{
  const b = fakeBackend();
  const s = fakeStore();
  const returned = applyVolume(b, 0.7, 'papyros.player.volume', s);
  check(deepEq(b._calls.setVolume, [0.7]), 'applyVolume calls backend.setVolume with the level');
  check(returned === 0.7, 'applyVolume returns the applied level');
  check(s._map.get('papyros.player.volume') === '0.7', 'applyVolume persists under the configured key');
}
{
  const b = fakeBackend();
  const returned = applyVolume(b, 1.8, 'v', fakeStore());
  check(deepEq(b._calls.setVolume, [1]) && returned === 1, 'applyVolume clamps BEFORE the backend sees the level (and returns the clamp)');
}
{
  // volumeStorageKey omitted → session-only: backend still driven, ZERO store writes.
  const b = fakeBackend();
  const s = fakeStore();
  const origSet = s.setItem;
  let writes = 0;
  s.setItem = (k, v) => { writes++; origSet(k, v); };
  applyVolume(b, 0.3, undefined, s);
  check(deepEq(b._calls.setVolume, [0.3]), 'applyVolume with no key still calls backend.setVolume');
  check(writes === 0 && s._map.size === 0, 'applyVolume with no key performs NO storage writes (session-only)');
}
{
  let threw = false;
  try { applyVolume(null, 0.5, undefined); } catch { threw = true; }
  check(threw === false, 'applyVolume with no backend mounted is a safe no-op (mirrors backendRef.current?.)');
}

/* ── applyMuted / the toggle mechanism ─────────────────────────────────── */
{
  const b = fakeBackend();
  const s = fakeStore();
  applyMuted(b, true, 'papyros.player.volume', s);
  check(deepEq(b._calls.setMuted, [true]), 'applyMuted calls backend.setMuted');
  check(s._map.get('papyros.player.volume.muted') === '1', 'applyMuted persists under `<key>.muted`');
  // toggleMute is the engine negating its mutedRef and re-calling the same mechanism.
  applyMuted(b, !true, 'papyros.player.volume', s);
  check(deepEq(b._calls.setMuted, [true, false]), 'toggling (negate + re-apply) drives backend.setMuted with the flipped flag');
  check(s._map.get('papyros.player.volume.muted') === '0', 'the toggled flag persists too');
}
{
  const b = fakeBackend();
  const s = fakeStore();
  applyMuted(b, true, undefined, s);
  check(deepEq(b._calls.setMuted, [true]), 'applyMuted with no key still calls backend.setMuted');
  check(s._map.size === 0, 'applyMuted with no key performs NO storage writes (session-only)');
}
{
  let threw = false;
  try { applyMuted(null, true, undefined); } catch { threw = true; }
  check(threw === false, 'applyMuted with no backend mounted is a safe no-op');
}

/* ── summary ──────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n✗ player/engine: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ player/engine: all assertions passed');
