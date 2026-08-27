// factory.test.mjs — unit tests for @jkos/player/factory's createPlayer(spec) +
// presets (git history: Wave 16 item 16.7; git history: PLAYER_PARITY.md, retired
// "Layer 3 — UI kit"). Covers:
//   1. resolveSpec's defaults (a bare `{ kind }` gets every capability off,
//      scrubberMode 'segment', mobileTransport 'full', no unbuilt flag).
//   2. audiobookPlayer()'s spec == today's papyros PlayerBar's capability set
//      (±30s skip, segment nav, rate/sleep/bookmarks on, volume/shuffle/repeat/
//      queue off) — the exact set apps/papyros/src/player/PlayerBar.tsx renders,
//      cross-checked against @jkos/player/engine/types' PlayerApi surface.
//   3. musicPlayer()'s spec (track nav, shuffle/repeat/queue/volume/accentFromArt
//      on, no skip/rate/sleep/bookmarks) and videoPlayer()'s (unbuilt: true).
//   4. createPlayer()'s derived transportControls/actionControls ordering for
//      each preset, and that it is CAPABILITY-driven, not kind-driven (a
//      hand-built spec gets the same shape a preset with the same capabilities
//      would).
//   5. createPlayer() refuses an unbuilt spec (videoPlayer()) but composes fine
//      once a caller overrides `unbuilt: false` — the Wave-19 escape hatch.
//   6. preset overrides merge (only the overridden capability changes, siblings
//      survive) and PlayerSpec stays inspectable even when createPlayer() throws.
//
// Node has no TS runner here, so this transpiles the real, self-contained
// src/factory/createPlayer.ts in-memory with the repo's own `typescript` dep
// (no runtime imports to erase or resolve) and imports the REAL exports — the
// house pattern, copied from test/core.test.mjs.
//
// Run:  node "packages/player/test/factory.test.mjs"
//       (auto-enumerated by packages/player/scripts/run-tests.mjs → `pnpm
//        --filter @jkos/player test`, chained into the root `pnpm test:contracts`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-factory-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Transpile a self-contained .ts module to ESM and import it.
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
  resolveSpec, createPlayer, audiobookPlayer, musicPlayer, videoPlayer,
} = await importTs('src/factory/createPlayer.ts', 'createPlayer.mjs');

/* ── resolveSpec defaults ─────────────────────────────────────────────────── */
const bare = resolveSpec({ kind: 'music' });
check(bare.scrubberMode === 'segment', 'resolveSpec: default scrubberMode is "segment"');
check(bare.mobileTransport === 'full', 'resolveSpec: default mobileTransport is "full"');
check(bare.unbuilt === undefined, 'resolveSpec: unbuilt is unset unless asked for');
check(deepEq(bare.capabilities, {
  skipSeconds: false, nav: false, rate: false, sleep: false, bookmarks: false,
  volume: false, shuffle: false, repeat: false, queue: false, accentFromArt: false,
}), 'resolveSpec: a bare { kind } gets every capability off');

/* ── audiobookPlayer() == today's papyros bar ────────────────────────────── */
const book = audiobookPlayer();
check(book.kind === 'audiobook', 'audiobookPlayer: kind is "audiobook"');
check(book.scrubberMode === 'segment', 'audiobookPlayer: scrubberMode is "segment" (chapter-window, PlayerBar.tsx today)');
check(book.mobileTransport === 'compact', 'audiobookPlayer: mobileTransport is "compact" (papyros collapses into a More sheet)');
check(book.unbuilt === undefined, 'audiobookPlayer: not unbuilt');
check(deepEq(book.capabilities, {
  skipSeconds: 30, nav: 'segment', rate: true, sleep: true, bookmarks: true,
  volume: false, shuffle: false, repeat: false, queue: false, accentFromArt: false,
}), 'audiobookPlayer: ±30s skip, segment nav, rate/sleep/bookmarks on, no volume/shuffle/repeat/queue');

/* ── musicPlayer() == Plexamp floor / Spotify ceiling ────────────────────── */
const music = musicPlayer();
check(music.kind === 'music', 'musicPlayer: kind is "music"');
check(music.scrubberMode === 'timeline', 'musicPlayer: scrubberMode is "timeline" (whole-track span + boundary ticks)');
check(music.mobileTransport === 'full', 'musicPlayer: mobileTransport is "full"');
check(deepEq(music.capabilities, {
  skipSeconds: false, nav: 'track', rate: false, sleep: false, bookmarks: false,
  volume: true, shuffle: true, repeat: true, queue: true, accentFromArt: true,
}), 'musicPlayer: track nav + shuffle/repeat/queue/volume/accentFromArt on, no skip/rate/sleep/bookmarks');

/* ── videoPlayer() == declared, unbuilt (Wave 19) ────────────────────────── */
const video = videoPlayer();
check(video.kind === 'video', 'videoPlayer: kind is "video"');
check(video.unbuilt === true, 'videoPlayer: unbuilt flag is set (Wave 19)');
check(typeof video.capabilities === 'object' && video.capabilities !== null,
  'videoPlayer: still returns a fully-formed, inspectable spec despite being unbuilt');

/* ── createPlayer() derived control lists — audiobook ────────────────────── */
const bookComp = createPlayer(book);
check(deepEq(bookComp.transportControls, ['segmentPrev', 'skipBack', 'playPause', 'skipFwd', 'segmentNext']),
  'createPlayer(audiobookPlayer()): transport is segmentPrev, skipBack, playPause, skipFwd, segmentNext');
check(deepEq(bookComp.actionControls, ['rate', 'sleep', 'bookmarks']),
  'createPlayer(audiobookPlayer()): actions are rate, sleep, bookmarks (no volume/queue)');
check(bookComp.spec === book || deepEq(bookComp.spec, book), 'createPlayer: composition.spec matches the resolved input spec');

/* ── createPlayer() derived control lists — music ─────────────────────────── */
const musicComp = createPlayer(music);
check(deepEq(musicComp.transportControls, ['shuffle', 'trackPrev', 'playPause', 'trackNext', 'repeat']),
  'createPlayer(musicPlayer()): transport is shuffle, trackPrev, playPause, trackNext, repeat (Plexamp/Spotify shape)');
check(deepEq(musicComp.actionControls, ['volume', 'queue']),
  'createPlayer(musicPlayer()): actions are volume, queue (no rate/sleep/bookmarks)');

/* ── createPlayer() is capability-driven, not kind-driven ────────────────── */
const handBuilt = createPlayer({ kind: 'music', capabilities: { nav: 'segment', skipSeconds: 15 } });
check(deepEq(handBuilt.transportControls, ['segmentPrev', 'skipBack', 'playPause', 'skipFwd', 'segmentNext']),
  'createPlayer: a hand-built spec with nav "segment" gets the segment transport shape regardless of kind');
check(deepEq(handBuilt.actionControls, []),
  'createPlayer: no action capabilities set → an empty actions list');

const noNav = createPlayer({ kind: 'audiobook', capabilities: { nav: false } });
check(deepEq(noNav.transportControls, ['playPause']),
  'createPlayer: nav false and no skip → transport is just playPause');

/* ── unbuilt refusal + escape hatch ───────────────────────────────────────── */
let threw = false;
try { createPlayer(video); } catch (e) { threw = true; check(/unbuilt/i.test(e.message), 'createPlayer(videoPlayer()): error message mentions "unbuilt"'); }
check(threw, 'createPlayer(videoPlayer()): throws — the preset is declared but not composable yet');

const unlockedVideo = videoPlayer({ unbuilt: false });
check(unlockedVideo.unbuilt === false, 'videoPlayer({ unbuilt: false }): the escape hatch overrides the default');
let unlockedThrew = false;
try { createPlayer(unlockedVideo); } catch { unlockedThrew = true; }
check(!unlockedThrew, 'createPlayer(videoPlayer({ unbuilt: false })): composes without throwing once unlocked');

/* ── overrides merge (siblings survive) ───────────────────────────────────── */
const noBookmarks = audiobookPlayer({ capabilities: { bookmarks: false } });
check(noBookmarks.capabilities.bookmarks === false, 'audiobookPlayer(overrides): the overridden capability changes');
check(noBookmarks.capabilities.rate === true && noBookmarks.capabilities.sleep === true,
  'audiobookPlayer(overrides): sibling capabilities (rate, sleep) survive untouched');
check(createPlayer(noBookmarks).actionControls.includes('bookmarks') === false,
  'createPlayer: the overridden preset composes without the disabled control');

/* ── summary ───────────────────────────────────────────────────────────────── */
console.log('─'.repeat(40));
if (failed) {
  console.error(`✗ factory.test.mjs: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ factory.test.mjs: all assertions passed');
