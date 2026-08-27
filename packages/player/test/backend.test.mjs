// packages/player/test/backend.test.mjs — MediaBackend seam unit test (git history
// Wave 15, item 15.2).
//
// packages/player has no TS runner wired yet (its package.json/tsconfig are being
// scaffolded by another agent in parallel), so this follows the TEST-9 house pattern
// (test/cards-logic.mjs, .claude/skills/new-tester/SKILL.md §3): transpile the REAL
// .ts module in-memory with the repo's own `typescript` dep (ts.transpileModule
// strips types; htmlMedia.ts's only import is `import type {...} from './types'`,
// fully erased by the compiler, so nothing else needs transpiling) and drive the
// REAL createHtmlMediaBackend() against a scripted FAKE element — never a
// re-implementation of the mapping being tested.
//
// Standalone: `node "packages/player/test/backend.test.mjs"` (repo path has a space
// — quote it). Not yet wired into `pnpm test:contracts` — that's the scaffolding
// agent's package.json/root-gate to own once packages/player exists as a real
// package; wire it there at integration time.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');   // packages/player
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-backend-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

// Transpile a self-contained .ts module to ESM and import it (mirrors
// test/cards-logic.mjs's importTs()).
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

// Sanity precondition: this run must have no DOM global, or the "never touches
// document" checks below wouldn't actually prove anything.
check(typeof document === 'undefined', 'precondition: no `document` global in this test run');

const { createHtmlMediaBackend } = await importTs('src/backend/htmlMedia.ts', 'htmlMedia.mjs');

// ── Fake element ─────────────────────────────────────────────────────────────────
// Scripts exactly the MediaElementLike surface htmlMedia.ts depends on: settable
// properties, addEventListener/removeEventListener with call-count tracking +
// manual firing, and a swappable play() implementation for the rejection-
// classification tests.
function createFakeElement() {
  const registry = new Map();   // type -> Set<fn>
  const addCalls = [];
  const removeCalls = [];
  const el = {
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
    playImpl: null,   // () => Promise<void> | void — override per test
    play() {
      el.playCalls++;
      if (typeof el.playImpl === 'function') return el.playImpl();
      el.paused = false;
      return Promise.resolve();
    },
    pause() {
      el.pauseCalls++;
      el.paused = true;
    },
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
    _fire(type, payload) {
      for (const fn of registry.get(type) ?? []) fn(payload);
    },
    _listenerCount(type) { return registry.get(type)?.size ?? 0; },
    _addCalls: addCalls,
    _removeCalls: removeCalls,
  };
  return el;
}

/* ── constructing with a provided element never touches document ────────────────── */
{
  const el = createFakeElement();
  let threw = null;
  try { createHtmlMediaBackend(el); } catch (err) { threw = err; }
  check(threw === null, 'createHtmlMediaBackend(el) with a provided element does not throw (never touches `document`)');
}
{
  // No element AND no `document` → the intentional guard error, not a bare
  // ReferenceError from touching `document` unguarded.
  let threw = null;
  try { createHtmlMediaBackend(); } catch (err) { threw = err; }
  check(threw instanceof Error && /document/.test(threw.message), 'createHtmlMediaBackend() with no element and no `document` throws the guarded error');
}

/* ── command → element-call mapping ──────────────────────────────────────────────── */
{
  const el = createFakeElement();
  const backend = createHtmlMediaBackend(el);

  backend.load({ url: 'https://example/book/0' });
  check(el.src === 'https://example/book/0', 'load() sets element.src to source.url');
  check(el.loadCalls === 1, 'load() calls element.load() exactly once');

  backend.seek(42.5);
  check(el.currentTime === 42.5, 'seek() sets element.currentTime');

  backend.setRate(1.75);
  check(el.playbackRate === 1.75, 'setRate() sets element.playbackRate');

  backend.setVolume(0.3);
  check(el.volume === 0.3, 'setVolume() sets element.volume');

  backend.setMuted(true);
  check(el.muted === true, 'setMuted() sets element.muted');

  backend.pause();
  check(el.pauseCalls === 1 && el.paused === true, 'pause() calls element.pause()');

  await backend.play();
  check(el.playCalls === 1 && el.paused === false, 'play() calls element.play() and resolves on success');

  check(backend.currentTime === el.currentTime, 'currentTime getter proxies the element');
  check(Number.isNaN(backend.duration), 'duration getter proxies the element (NaN before metadata)');
  check(backend.rate === 1.75, 'rate getter proxies playbackRate');
  check(backend.volume === 0.3, 'volume getter proxies volume');
  check(backend.muted === true, 'muted getter proxies muted');

  backend.dispose();
}

/* ── event forwarding + payload shapes ───────────────────────────────────────────── */
{
  const el = createFakeElement();
  const backend = createHtmlMediaBackend(el);
  const seen = [];
  const unsub = backend.on((ev) => seen.push(ev));

  const payloadFreeTypes = ['loadedmetadata', 'timeupdate', 'play', 'pause', 'waiting', 'playing', 'ended'];
  for (const type of payloadFreeTypes) el._fire(type);

  check(seen.length === 7, 'all 7 payload-free DOM events forward through on()');
  check(seen.every((ev, i) => ev.type === payloadFreeTypes[i]), 'forwarded events preserve type + firing order');
  check(seen.every((ev) => Object.keys(ev).length === 1), 'payload-free events carry only `type` (no speculative extras)');

  unsub();
  el._fire('play');
  check(seen.length === 7, 'unsubscribe stops further delivery to that listener');

  backend.dispose();
}

/* ── error classification: element `error` DOM event → BackendErrorKind ─────────── */
{
  const cases = [
    [1, 'aborted'],
    [2, 'network'],
    [3, 'decode'],
    [4, 'src-unsupported'],
    [99, 'unknown'],
  ];
  for (const [code, kind] of cases) {
    const el = createFakeElement();
    const backend = createHtmlMediaBackend(el);
    const seen = [];
    backend.on((ev) => seen.push(ev));
    el.error = { code, message: `boom-${code}` };
    el._fire('error');
    check(seen.length === 1 && seen[0].type === 'error', `MediaError code ${code} forwards exactly one 'error' event`);
    check(seen[0].error.kind === kind, `MediaError code ${code} classifies as '${kind}'`);
    check(seen[0].error.code === code, `MediaError code ${code} preserves the raw code`);
    check(seen[0].error.message === `boom-${code}`, `MediaError code ${code} preserves MediaError.message`);
    backend.dispose();
  }

  // Message fallback when MediaError.message is empty/absent.
  {
    const el = createFakeElement();
    const backend = createHtmlMediaBackend(el);
    const seen = [];
    backend.on((ev) => seen.push(ev));
    el.error = { code: 2 };
    el._fire('error');
    check(seen[0].error.message === 'media error (code 2)', 'empty MediaError.message falls back to a diagnostic default');
    backend.dispose();
  }

  // A stray 'error' DOM event with no MediaError attached must not emit.
  {
    const el = createFakeElement();
    const backend = createHtmlMediaBackend(el);
    const seen = [];
    backend.on((ev) => seen.push(ev));
    el.error = null;
    el._fire('error');
    check(seen.length === 0, "a stray 'error' event with element.error === null emits nothing");
    backend.dispose();
  }
}

/* ── error classification: rejected play() promise → BackendErrorKind ───────────── */
{
  const rejectionCases = [
    ['NotAllowedError', 'autoplay-blocked'],
    ['NotSupportedError', 'src-unsupported'],
    ['AbortError', 'aborted'],
    ['SomeWeirdError', 'unknown'],
  ];
  for (const [name, kind] of rejectionCases) {
    const el = createFakeElement();
    const backend = createHtmlMediaBackend(el);
    el.playImpl = () => Promise.reject({ name, message: `rejected-${name}` });
    let caught = null;
    try { await backend.play(); } catch (err) { caught = err; }
    check(caught !== null, `play() rejection (${name}) propagates as a rejected promise`);
    check(caught?.kind === kind, `play() rejection name '${name}' classifies as '${kind}'`);
    check(caught?.code === null, 'play() rejection carries code: null (no MediaError involved)');
    check(caught?.message === `rejected-${name}`, 'play() rejection preserves the original message');
    backend.dispose();
  }

  // A SYNCHRONOUS throw from element.play() (not a rejected promise) must classify
  // the same way — the autoplay-blocked signal has to survive either shape.
  {
    const el = createFakeElement();
    const backend = createHtmlMediaBackend(el);
    el.playImpl = () => { throw { name: 'NotAllowedError', message: 'sync-blocked' }; };
    let caught = null;
    try { await backend.play(); } catch (err) { caught = err; }
    check(caught?.kind === 'autoplay-blocked', 'a synchronous throw from play() also classifies as autoplay-blocked');
    backend.dispose();
  }
}

/* ── listener cleanup on dispose (no leaks) ──────────────────────────────────────── */
{
  const el = createFakeElement();
  const backend = createHtmlMediaBackend(el);

  check(el._addCalls.length === 8, 'construction wires exactly 8 DOM listeners (loadedmetadata/timeupdate/play/pause/waiting/playing/ended/error)');
  const addedTypes = [...el._addCalls].sort();

  backend.dispose();

  const removedTypes = [...el._removeCalls].sort();
  check(el._removeCalls.length === 8, 'dispose() removes exactly 8 DOM listeners');
  check(JSON.stringify(addedTypes) === JSON.stringify(removedTypes), 'every added listener type is removed exactly once (symmetric add/remove pairs)');
  check(
    ['loadedmetadata', 'timeupdate', 'play', 'pause', 'waiting', 'playing', 'ended', 'error'].every((t) => el._listenerCount(t) === 0),
    'no listeners remain registered on the element after dispose()',
  );
  check(el.pauseCalls === 1, 'dispose() pauses the element');
  check(el.src === '', 'dispose() clears element.src');

  // dispose() is idempotent — a second call must not double-remove or re-pause.
  backend.dispose();
  check(el._removeCalls.length === 8, 'a second dispose() is a no-op (idempotent)');
  check(el.pauseCalls === 1, 'a second dispose() does not call pause() again');

  // Firing an event on the (still-fake) element after dispose must not reach the
  // backend's own subscribers — proves the forwarding handlers were truly detached,
  // not just internally deaf.
  const seenAfterDispose = [];
  backend.on((ev) => seenAfterDispose.push(ev));
  el._fire('play');
  check(seenAfterDispose.length === 0, 'events fired after dispose() are not forwarded');
}

/* ── summary ──────────────────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n✗ backend: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ backend: all assertions passed');
