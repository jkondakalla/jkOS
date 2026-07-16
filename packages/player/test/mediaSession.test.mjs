// packages/player/test/mediaSession.test.mjs — unit tests for the PURE half of the
// MediaSession service (Wave 16, item 16.3): src/services/mediaSessionState.ts —
//   1. toMetadataInit    — the app-metadata → MediaMetadata-init mapping (the engine's
//                          old inline defaults: artist/album '' fallbacks, artwork []).
//   2. toPositionState   — the setPositionState validation/clamp gate (the NEW
//                          capability): reject an unusable duration, clamp position
//                          into [0, duration], neutralize a degenerate playbackRate —
//                          every case the spec would THROW on becomes unreachable.
//
// The hook itself (services/useMediaSession.ts) is navigator/window wiring behind
// feature guards; its behavior is proven by the papyros composition + the wave gate,
// NOT by a jsdom harness (the repo has none) — the same split as test/engine.test.mjs
// vs the engine hook. House pattern: transpile the real .ts in-memory, import the
// REAL functions, drive them (copied from test/engine.test.mjs).
//
// Run:  node "packages/player/test/mediaSession.test.mjs"   (auto-enumerated by
//       scripts/run-tests.mjs → `pnpm --filter @jkos/player test` → root gate).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-mediasession-'));

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

const {
  MEDIA_SESSION_ACTIONS, toMetadataInit, toPositionState,
} = await importTs('src/services/mediaSessionState.ts', 'mediaSessionState.mjs');

/* ══════════════════════════════════════════════════════════════════════ *
 * MEDIA_SESSION_ACTIONS — exactly the engine's old inline set, in order
 * ══════════════════════════════════════════════════════════════════════ */
check(
  deepEq([...MEDIA_SESSION_ACTIONS], ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto']),
  'MEDIA_SESSION_ACTIONS is exactly the seven actions the inline block installed, in install order',
);

/* ══════════════════════════════════════════════════════════════════════ *
 * toMetadataInit — the MediaMetadata init mapping
 * ══════════════════════════════════════════════════════════════════════ */
{
  const art = [{ src: '/api/books/5/cover', sizes: '512x512', type: 'image/jpeg' }];
  const init = toMetadataInit({ title: 'Dune', artist: 'Frank Herbert', album: 'Dune Saga', artwork: art });
  check(deepEq(init, { title: 'Dune', artist: 'Frank Herbert', album: 'Dune Saga', artwork: art }), 'toMetadataInit passes a full metadata object through unchanged');
  check(init.artwork[0].sizes === '512x512' && init.artwork[0].type === 'image/jpeg', "artwork entries pass through untouched (papyros's 512x512 JPEG shape)");
}
check(toMetadataInit({ title: 'T' }).artist === '', "toMetadataInit defaults a missing artist to '' (the inline block's ?? '')");
check(toMetadataInit({ title: 'T' }).album === '', "toMetadataInit defaults a missing album to ''");
check(deepEq(toMetadataInit({ title: 'T' }).artwork, []), 'toMetadataInit defaults missing artwork to [] (the inline block advertised none)');
check(toMetadataInit({ title: '', artist: '', album: '' }).title === '', 'toMetadataInit keeps explicit empty strings (no invented placeholders)');

/* ══════════════════════════════════════════════════════════════════════ *
 * toPositionState — the setPositionState gate (every spec-throw unreachable)
 * ══════════════════════════════════════════════════════════════════════ */

/* ── no sample at all ──────────────────────────────────────────────────── */
check(toPositionState(null) === null, 'toPositionState(null) → null (nothing to push)');
check(toPositionState(undefined) === null, 'toPositionState(undefined) → null (position prop omitted)');

/* ── the happy path ────────────────────────────────────────────────────── */
check(
  deepEq(toPositionState({ position: 10, duration: 100, playbackRate: 1.25 }), { duration: 100, position: 10, playbackRate: 1.25 }),
  'toPositionState passes a valid in-range sample through unchanged',
);
check(
  deepEq(toPositionState({ position: 0, duration: 3600, playbackRate: 1 }), { duration: 3600, position: 0, playbackRate: 1 }),
  'toPositionState keeps position 0 (start of book)',
);
check(
  deepEq(toPositionState({ position: 3600, duration: 3600, playbackRate: 1 }), { duration: 3600, position: 3600, playbackRate: 1 }),
  'toPositionState keeps position === duration (true end — spec allows the closed bound)',
);

/* ── duration guards (spec throws on NaN/∞/negative — reject the sample) ─ */
check(toPositionState({ position: 5, duration: NaN, playbackRate: 1 }) === null, 'toPositionState rejects a NaN duration (metadata not loaded yet)');
check(toPositionState({ position: 5, duration: Infinity, playbackRate: 1 }) === null, 'toPositionState rejects an infinite duration (live streams have no scrubber)');
check(toPositionState({ position: 5, duration: -1, playbackRate: 1 }) === null, 'toPositionState rejects a negative duration');
check(
  deepEq(toPositionState({ position: 5, duration: 0, playbackRate: 1 }), { duration: 0, position: 0, playbackRate: 1 }),
  'toPositionState accepts duration 0 (finite, ≥ 0) and clamps position down to it',
);

/* ── position clamps into [0, duration] (spec throws outside the range) ── */
check(
  toPositionState({ position: 150, duration: 100, playbackRate: 1 }).position === 100,
  'toPositionState clamps position above duration down to duration (timeupdate racing a source swap)',
);
check(
  toPositionState({ position: -3, duration: 100, playbackRate: 1 }).position === 0,
  'toPositionState clamps a negative position up to 0',
);
check(
  toPositionState({ position: NaN, duration: 100, playbackRate: 1 }).position === 0,
  'toPositionState treats a non-finite position (NaN) as 0 rather than rejecting the sample',
);

/* ── playbackRate guards (spec throws on exactly 0; non-finite is garbage) */
check(
  toPositionState({ position: 5, duration: 100, playbackRate: 0 }).playbackRate === 1,
  'toPositionState neutralizes playbackRate 0 (a spec throw) to 1',
);
check(
  toPositionState({ position: 5, duration: 100, playbackRate: NaN }).playbackRate === 1,
  'toPositionState neutralizes a NaN playbackRate to 1',
);
check(
  toPositionState({ position: 5, duration: 100, playbackRate: Infinity }).playbackRate === 1,
  'toPositionState neutralizes an infinite playbackRate to 1',
);
check(
  toPositionState({ position: 5, duration: 100, playbackRate: -1 }).playbackRate === -1,
  'toPositionState preserves a negative NON-zero playbackRate (spec-legal: reverse playback)',
);
check(
  toPositionState({ position: 5, duration: 100, playbackRate: 2.5 }).playbackRate === 2.5,
  "toPositionState preserves papyros's fastest preset (2.5) unchanged",
);

/* ── summary ──────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n✗ player/mediaSession: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ player/mediaSession: all assertions passed');
