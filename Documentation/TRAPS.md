# jkOS — Traps

A trap is a fact about an engine, a library, a filesystem, a runtime, or this repo's shape that
cost real debugging time and will cost it again if forgotten. This is not project history — it's
what survives from 59 memory files after everything about *when* something shipped or *who*
decided what was stripped out. `Documentation/RESET.md` is where decisions live; this is where
scar tissue lives.

Every claim below that names a file, function, flag, or command was re-checked against the repo
on 2026-08-26 (branch `staging` @ `1e278fb`). Where a fix has already landed, the trap is written
as "this bit once, here's the defence that's live now" rather than as an open problem — the
mechanism is still worth knowing even where the wound has healed, because the next person to touch
that code can reopen it.

---

## CSS & browser engines

- **`@supports selector(::-webkit-scrollbar)` answers YES in Gecko, which implements none of it.**
  Selectors-4 says an engine must *parse* an unknown vendor-prefixed pseudo-element as valid rather
  than drop the whole rule, and Firefox obeys — so a guard written as
  `@supports not (selector(::-webkit-scrollbar))` (meaning "engines with no webkit pseudos to
  lose") evaluates **false** in the one engine it exists to protect, and Gecko gets neither
  syntax. `::-webkit-scrollbar-thumb` is the query that actually discriminates (Blink: yes,
  Gecko: no). Live defence: `packages/design/tokens/hub.css` guards on
  `@supports (not (selector(::-webkit-scrollbar-thumb))) or (-moz-orient: inline)`, and
  `test/scrollbar.mjs` (`pnpm check:scroll`) serves hub.css to headless Chromium *and* headless
  Firefox and reads back computed style — a text scan cannot catch this because the CSS is
  well-formed and inert; only a real engine measurement can.

- **Blink's two scrollbar syntaxes are mutually exclusive.** Set `scrollbar-color` (for Firefox)
  and Chrome discards *every* `::-webkit-scrollbar-*` rule and paints its own themed bar — with
  stepper arrows at both ends that nothing removes. The fix is never setting both on the same
  engine: standard properties live behind the Gecko-only `@supports` branch above, webkit pseudos
  outside it. Styling any one webkit scrollbar part also drops the bar out of overlay mode, so an
  unstyled `::-webkit-scrollbar-corner` renders as an opaque OS-grey square and
  `::-webkit-scrollbar-button` needs an explicit `display: none`.

- **`scrollbar-color` inherits.** A `:hover`-reveal rule on a parent hands the *revealed* value to
  every nested scroller under the pointer, not just the one being hovered — pointing at anything
  lights up every scrollbar on the page. Gecko therefore gets one resting rung, always painted,
  never a hover reveal (`packages/design/tokens/hub.css`, "Scrollbars" section).

- **`color-scheme` is the only lever over an engine's own chrome** — a `<select>` dropdown list,
  the date/time picker, autofill, the caret. No selector reaches any of them. Missing it on one
  app while every other app sets it (`packages/design/tokens/hub.css` on `:root`) means that one
  app's dark mode gets a white OS dropdown with no visible cause.

- **A bare `background` shorthand resets `background-clip` to `border-box`.** Any drawn mark built
  as `border: Npx solid transparent` + `background-clip: content-box` (a fine scrollbar thumb, a
  fine gutter mark) must restate `background-clip` on *every* pseudo-state (`:hover`, `:active`),
  or the state's shorthand silently balloons the mark to fill its whole hit box.

- **A gradient bevel must be authored at the resolution it rasterises at.** Sub-pixel gradient
  stops on a box a few device-pixels tall (`0 0.5px`, `3.6px 4px`) render as a flat line — the
  engine averages each pair of sub-pixel bands into one device row, cancelling opposing
  highlight/shadow bands against each other. Fix: one band per whole device pixel, box height
  equal to band count.

- **`mask-image` clips a `filter: drop-shadow()` to the border box, and `mask-clip: no-clip`
  does not lift it** (verified against `border-area` too). A tapered glowing bar built as
  `filter: drop-shadow(...)` + a taper `mask-image` renders with square ends and no glow. Fix:
  make the box taller than the visible object, draw the glow as a *background layer inside* the
  masked box — the same mask then shapes the light instead of clipping it away.

- **Equal specificity + declared later wins, silently, even against an earlier primitive's
  properties.** A class meant to *compose* with an earlier primitive (e.g. narrowing a card's
  radius for a tab context) that is declared after it in the stylesheet will blank any property
  it re-touches, even a property it never meant to own. Any composing class must explicitly guard
  (`:not([aria-selected="true"])`, etc.) the properties the earlier primitive is responsible for.

- **CSS grid places definite-position items before auto-placed ones.** If exactly one child of a
  grid has explicit `gridRow`/`gridColumn` and its siblings don't, grid gives the explicit child
  its cell *first*; auto-placement then finds that cell occupied and can push a sibling into an
  **implicit** row, silently collapsing a declared `1fr` row to `0px` while the implicit row
  absorbs the free space. The element sitting in the zero-height row renders, has a full DOM
  subtree, throws nothing — it just has `offsetHeight === 0`. Bit BeigeBoard's task-detail panel
  twice. Fix in this repo: `.jk-panel` (`packages/design/tokens/hub.css`) is `position: absolute`
  — load-bearing, not styling, because it removes the overlay from grid placement entirely — and
  every shell-grid child gets **explicit** placement so auto-placement never runs at all.
  `pnpm check:overlay` (`test/overlay-panel.mjs`) asserts both.

- **A transform "in effect" — even mid-animation, even with `animation-fill-mode` making it look
  static before/after — makes the element a CSS containing block for `position: fixed`
  descendants.** A popup hosted inside an entrance-animated container mispositions the moment the
  animation plays. Fix, documented directly in `packages/design/tokens/hub.css` ("NO fill-mode on
  purpose … the fill-mode, not the resolved value, is what matters"): entrance keyframes end on
  `transform: none`, and classes like `.view-enter`/`.panel-enter` carry no fill-mode at all.

- **The React `background` shorthand and `backgroundImage` fight, and React's diffing loses the
  image.** Setting `style={{ background: color }}` on hover after mounting with
  `style={{ backgroundImage: url }}` resets the image layer to `none` — the shorthand always wins
  — and because React's style diff only rewrites the keys that *changed*, the image never comes
  back. Always use `backgroundColor` in React inline styles, never the shorthand, when an
  `backgroundImage` layer is also in play.

- **A header grid that doesn't scroll can't share a column template with a body grid that does.**
  The scrollbar's width comes out of the *scroller's own* content box only, so a fixed header
  above a scrolling body drifts out of column alignment by the gutter width — no CSS-only fix
  exists because nothing tells a sibling how wide a neighbour's scrollbar is. This repo measures
  it: `packages/cards/src/useScrollGutter.ts` (`offsetWidth − clientWidth` + a `ResizeObserver`)
  pads the header bands, with `scrollbar-gutter: stable` on the scroller so the reservation can't
  flicker.

- **A React portal's subtree executes in the *parent* JS realm, not the container it's visually
  rendered into.** A component using `window.matchMedia`/`useBreakpoint()` inside an iframe-wrapped
  portal reads the outer document's width, not the iframe's — wrapping the preview in a narrower
  iframe does not contain it. Any breakpoint-branching component embedded via a design tool,
  a preview pane, or any portal-based UI is at risk of rendering its narrowest branch regardless
  of the container's actual size.

- **`appearance: base-select`'s `::picker-icon` must have its `content` explicitly cleared**, or a
  custom chevron layered on top of the picker draws *over* the OS glyph instead of replacing it —
  two arrows. Chromium-only feature; gate behind `@supports (appearance: base-select)`
  (`packages/design/tokens/hub.css`).

- **`stepUp()`/`stepDown()` fire no `input`/`change` event, and assigning `el.value` directly
  updates React's internal value tracker** so the event you *do* get afterward looks like a no-op
  change to React and never fires the handler. Fix: re-dispatch via the native prototype's
  `value` property setter descriptor rather than the element's own `.value =`.

- **A plain arrow-function wrapper silently swallows a forwarded `ref`** — React strips `ref` from
  a function component's own props with no warning. Every input wrapper in this suite is
  `forwardRef`; `test/fields.mjs` (`pnpm check:fields`) asserts every field primitive is declared
  `= forwardRef<...>` by scanning the exported source.

- **Vendor-prefixed pseudo-selectors cannot be grouped in one comma-separated rule across
  engines** — the moment one engine hits a selector it doesn't recognise, it drops the *entire*
  rule, not just that branch. Each vendor variant needs its own rule.

- **A `<div>` (or a `<span>` pair meant to stack) inside a `<button>` needs an explicit `display`.**
  Spans are inline by default; a button whose whole row is clickable and contains a title +
  subtitle span pair will run them together on one line and overflow unless the pair is
  explicitly `display: flex; flex-direction: column`.

- **A pixel *mean* is not a dominant colour — it converges to mud.** Averaging every pixel of an
  album sleeve for an accent colour returns dead slate on nearly every image regardless of how
  saturated the art is. The fix is a saturation-weighted hue *histogram* with a **circular** mean
  (arithmetic-averaging 359° and 1° gives 180° — cyan — for two reds; hue is an angle, not a
  scalar), clamped into a usable chrome range.

## Node, pnpm & the build

- **`inject-workspace-packages=true` (`.npmrc`) means every `@jkos/*` package with a
  `peerDependencies` entry is a hardlinked *copy* under `node_modules/.pnpm/`, not a symlink.**
  Editing a file under `packages/*/src` is invisible to every consumer — `tsc`, `vite build`, a
  dev server, even a Playwright screenshot — until `pnpm install` re-syncs the copy. This is the
  single most repeated trap across this project's history (hit in `@jkos/cards`, `@jkos/weave`,
  `@jkos/ui`, `@jkos/design`, at minimum). All of it passes/renders convincingly green against
  stale code; the tell is a built JS hash that doesn't change when it obviously should. `.npmrc`
  documents the trade explicitly: *"workspace packages are now INJECTED (hardlinked copies) into
  their consumers instead of symlinked, so after editing a packages/\* SOURCE file run `pnpm
  install` for the change to propagate in local dev."* Sequence that actually works: edit →
  `pnpm install` → confirm the injected copy changed (`grep` your edit under
  `node_modules/.pnpm/@jkos+<pkg>@*/`) → restart any running dev server with `--force` (a running
  Vite keeps its pre-install module graph even after re-injection).

- **The ZFS/Docker `ERR_PNPM_EAGAIN` fix is `package-import-method=hardlink`, not concurrency
  limiting.** `copy_file_range` returns spurious `EAGAIN` under overlay-on-ZFS (TrueNAS) and
  pnpm's default copy-based store import dies mid-install; hardlink imports use `link()` and
  never touch that syscall. `.npmrc`'s own comment records that an earlier `child-concurrency=1`
  workaround was later removed once hardlink alone was confirmed as the real fix — concurrency
  limiting had only been serialising installs and making cold builds ~6× slower for no EAGAIN
  benefit.

- **With `inject-workspace-packages`, a Dockerfile that installs dependencies *before* copying
  application source freezes any peer-dependency workspace package at manifest-only** (its
  `package.json` present, its `src/` absent), because the injected copy is created at install
  time and a later `COPY . .` updates `packages/<dep>/src` on disk but not the already-frozen
  store copy — `tsc` then fails `TS2307 Cannot find module '@jkos/<pkg>'`. Fix, applied in
  `apps/beigeboard/Dockerfile` (and required by `pnpm check:docker` / `test/dockerfile-inject.mjs`
  for any app doing the same install-before-copy layout for cache reasons): a second
  `RUN pnpm install --frozen-lockfile --filter <app>...` *after* `COPY . .`, so the store just
  re-hardlinks against the now-present source. ORDECK is immune because it copies source before
  installing.

- **A shared package gaining a new workspace dependency is a deploy-surface change for every
  Docker image that bundles it, and nothing in the unit/contract gate can catch it** (the gate
  never builds an image). `pnpm deploy --prod /out` only bundles source already present on disk,
  and a Dockerfile that hand-lists `COPY packages/<x> packages/<x>` before the deploy step rots
  the moment `<x>` (or anything it depends on) gains a new dependency — the bundle ships that
  dependency's `package.json` with no `index.js`, and the container `MODULE_NOT_FOUND`
  crash-loops at boot. `test/dockerfile-inject.mjs` (`pnpm check:docker`) now asserts the copied
  package set is **closed under workspace dependencies** for every backend Dockerfile — copying a
  package means copying what it depends on, transitively. A wholesale `COPY packages/ packages/`
  is closed by construction and immune (`apps/jkauth/Dockerfile` does this).

- **A Dockerfile that copies manifests selectively (not `COPY . .`) must explicitly list
  `.npmrc`** in that copy, or the manifest-only install layer never sees
  `inject-workspace-packages`/`package-import-method` and pnpm falls back to default behaviour.
  Confirmed still done in `apps/jkauth/Dockerfile` and `apps/beigeboard/Dockerfile`.

- **`vite dev` is broken for BeigeBoard and ORDECK**: `packages/auth-middleware/codes.js` is CJS,
  and a dev-mode ESM named import (`import { CODES } from '@jkos/auth-middleware/codes'`) fails
  to resolve the named export under Vite's dev transform, rendering a blank page with no console
  error pointing at the cause. Verify either app via `pnpm build` + a static server / `vite
  preview`, never `vite dev`.

- **A CDP/screenshot harness needs care with two independent timing traps.** Chrome's
  `--screenshot` flag fires on the page's `load` event, before a polling React app has any data —
  and the documented fix, `--virtual-time-budget`, never settles for a polling app because virtual
  time races through the app's own poll timers, each of which issues a *real* network request that
  can't resolve inside virtual time. Both failure modes look identical to "the app is broken."
  Drive the page over the raw DevTools Protocol instead (navigate → real sleep → capture), which
  is necessary here anyway because Node 20 has no global `WebSocket` and this repo has no `ws`
  dependency — the driver is a ~70–90 line hand-rolled WebSocket frame encoder/decoder over `net`.
  When a virtual-time budget IS appropriate (a static, non-polling render), give it generously —
  a 9s budget can still cut off a multi-second intro animation, so retry until a real signal
  (max pixel luminance, a specific computed style) confirms settling rather than trusting the
  first frame.

- **Playwright launches headless Chromium with `--hide-scrollbars` by default**, which defeats any
  test that needs to see actual scrollbar chrome — pass
  `ignoreDefaultArgs: ['--hide-scrollbars']` explicitly. The same flag must never be added by hand
  to a manual headless-Chrome screenshot harness that's trying to verify scrollbar rendering
  (headless Chrome paints scrollbars by default without it).

- **`JSON.parse`'s error message differs by JS engine, and modern V8 gives no character
  position at all** — a parser that extracts a position via `/position (\d+)/` silently never
  matches in Chrome/Node even though it works in Firefox. The snippet V8 does include is a literal
  substring of the input, so recovering the offset via `indexOf` on that snippet is the
  engine-independent fix.

- **An in-process fake server driven synchronously from the same event loop it must call back
  into will deadlock.** Faking an upstream (e.g. a local Ollama stand-in) and invoking the code
  under test via `spawnSync` freezes the one loop that has to answer the fake's own request; use
  async `spawn` for anything that round-trips through code sharing the test process's event loop.

- **`react-dom/server`'s default (`.node`) build requires `require('stream')`, which an ESM
  bundle assembled with esbuild in `/tmp` cannot shim.** Import `react-dom/server.browser`
  instead for a headless SSR-based render harness with no real browser available. Separately,
  esbuild's binary in this repo lives at `node_modules/.pnpm/node_modules/.bin/esbuild`, not the
  usual `node_modules/.bin/esbuild`; and the bundle must be *run* from inside the consuming app's
  own directory (e.g. `apps/beigeboard/`), not from a scratchpad — `react`/`react-dom` bare
  specifiers and `react-dom/server` resolve off the process's CWD, and running from elsewhere
  either fails to resolve or (worse) pulls in a second copy of React that makes every hook throw.

- **An object literal rebuilt fresh on every render (e.g. `const api = { get, post, patch, del }`)
  used as an effect dependency triggers a refetch on *every* parent re-render**, not just once on
  mount — any "fetch once" `useEffect([api])` pattern needs that object `useMemo`'d, and any
  closure captured *inside* it (e.g. an auth-redirect handler) hoisted to module scope or it
  defeats the memo by capturing a new closure each time anyway. Confirmed fixed live in
  `apps/beigeboard/src/App.tsx` (`const api = useMemo(...)`).

- **An undebounced write fired on every `onChange` event costs one write per keystroke/click for
  what is really one user gesture** (a held arrow key, a run of stepper clicks) — and if the write
  also triggers a cascading refetch, a single gesture can produce a request burst in the low
  dozens per second. Fix pattern: a local draft state + a debounce + an immediate flush on blur +
  a flush-on-unmount **through a ref** (a plain closure captures the log as it was at render time
  and will silently drop the last edit on unmount). The reconcile rule that makes the draft safe:
  drop it the moment nothing is queued, so props become the source of truth again — including when
  the truth changed from elsewhere (a clear, a server re-render).

## SQLite & data

- **Always copy a SQLite database's `-wal` and `-shm` sidecars together with the `.db` file** — a
  live WAL-mode database has uncommitted-to-disk writes sitting in `-wal`, and querying the bare
  `.db` alone reads a stale snapshot that can show *nothing* even when the data genuinely exists.
  Copy to a scratch location and query the copy; never open the live file read-write for a check.

- **`cp` on a live WAL-mode database is not atomic — use `VACUUM INTO`.** A plain file copy of a
  database that's mid-write (a commit-per-row backfill, for instance) captures a pre-checkpoint
  snapshot that opens cleanly, reports a smaller-but-entirely-plausible row count, and is
  **indistinguishable downstream** from "the job hasn't reached this point yet." `VACUUM INTO` is
  SQLite's own atomic, fully-checkpointed single-file export. `music/ship.py`'s module docstring
  states this as its whole reason to exist: *"The defence is `VACUUM INTO`, not 'remember to copy
  two files.'"*

- **A resume mechanism built as "the absence of a join partner" (a `LEFT JOIN` finding rows with
  no matching output row) breaks if the row that marks *failure* is only ever written on
  *success*.** A total, permanent failure mode (e.g. a missing system binary the code depends on)
  then never gets a row written at all, so every restart re-attempts and re-fails the entire
  backlog from scratch — a busy-spin on every boot rather than a one-time error. Look for this
  wherever a cache or ledger's "skip this, it's done" key is also its "it succeeded" artifact; a
  missing-dependency failure needs its own explicit, persisted marker independent of the success
  path.

- **`datetime('now')` in SQLite has whole-second resolution, and two second-vs-millisecond ISO
  timestamp formats sort *incorrectly against each other* as plain strings** (not just
  imprecisely — genuinely out of order), so a `?since=` cursor built on either can silently drop
  same-second writes, and a suite mixing both formats across apps cannot share a cursor even in
  principle. As of this pass this is still an open cross-app inconsistency (`RESET.md` §"Stage
  D" item 4, tracked as XC-1) — BeigeBoard's `items` table already migrated to millisecond ISO
  timestamps for exactly this reason; other collections have not.

- **A completion/state-transition timestamp written by a route handler has an open bypass any
  other write path (a bulk import, a raw SQL fixup) can walk straight through — a database
  trigger cannot be bypassed the same way.** Stamping `completed_at` via an `UPDATE`-time SQLite
  trigger (matching the pattern the trigger already uses for the paired `completed`/`started`
  columns) closes every write path at once instead of requiring every future write path to
  remember to set it.

- **A stat-comparison guard that treats "not observed" the same as "changed" can delete
  already-computed derived data on what looks like a harmless read-only call.** A file-tracking
  upsert comparing a freshly observed `mtime`/`size` against a stored value, with unobserved
  arguments defaulting to `None`, must never let `None` compare as "different from" a real stored
  number (`12345.0 != None` is `True` in Python) — an innocuous "give me the id for this path"
  call with no stat data supplied silently reset the row to pending and deleted its vectors.
  `None` has to mean "not observed, don't compare," never a sentinel zero. Confirmed fixed and
  documented in `music/index.py`'s `upsert_track()` docstring.

- **A cache dict keyed by `(name, signature)` that calls `.clear()` on *any* miss defeats its own
  purpose the moment it holds more than one entry per signature** — each new key evicts every
  other entry already cached under the same signature, so a rotation of 4 different cache keys
  under one signature never actually caches anything; every call is a rebuild. The same
  check-then-clear gap also races under threads: one thread's `if name not in cache` can be
  answered `True` by another thread's concurrent `.clear()`, producing a spurious `KeyError`.
  Fix: invalidate the *whole* cache only when the signature itself changes, and hold a lock across
  the check-and-fill.

- **A dropped network mount (CIFS/SMB) does not hang — it `ENOENT`s in milliseconds.** A
  multi-hour unattended batch job with no mount-health circuit breaker can, on a momentary
  network blip, mark thousands of remaining rows `failed` in seconds — and if the resume query's
  definition of "still pending" *excludes* failed rows (a reasonable definition on its own), a
  re-run will silently skip the whole backlog and report a finished library. Guard with an
  explicit reachability check before marking anything failed, and a consecutive-failure threshold
  that stops the run (leaving rows `pending`, not `failed`) rather than trusting each failure in
  isolation.

## Python & numpy

- **A Python default argument is evaluated exactly once, at function-definition time (import),
  not per call — and a name that *looks* like a live reference to a module "constant" is
  actually a frozen copy of whatever that constant held at import time.** Three separate
  functions in `music/` captured a module constant this way: `audio.decode(path, sr=SR)`,
  `scan.iter_tracks(root=LIBRARY_ROOT)`, and `index.connect(path=DB_PATH)`. Consequences ranged
  from silent to destructive: a context-manager-based config override (`with
  config.using(...)`) that should have changed the active sample rate did nothing to code that
  had already captured `SR` at import, and redirecting `index.DB_PATH` at a scratch copy for an
  "isolated" verification run **silently wrote real vectors into the production index** instead.
  The fix, applied throughout `music/`: default to `None`, and read the live module attribute
  inside the function body at call time. Any function whose default argument is meant to track a
  module-level "current configuration" value is at risk of this — grep for defaults that reference
  a module constant by name rather than `None`.

- **`np.fft.rfft` does not preserve `float32` — it upcasts to `complex128` on output,
  unconditionally.** A whole-track FFT computed in one call for a long file can be a multi-gigabyte
  transient allocation with no warning. `music/mel.py` computes the transform in fixed-size
  blocks (`BLOCK_FRAMES`) specifically so peak memory tracks block size, not track length, with a
  test asserting blocked and unblocked results are bitwise identical.

- **The mel scale is not a constant-Q (log-frequency) axis** — it is roughly linear below ~1 kHz
  and logarithmic above, so equal-Hz spans map to very different amounts of mel depending on
  register (measured: 701 mel for 4400→8800 Hz vs. 242 mel for 220→440 Hz, an octave each).
  Treating mel bands as "one unit per perceptual step" uniformly across the spectrum is a
  different transform (constant-Q) and will misread band indices. A filterbank test asserting a
  literal partition-of-unity (adjacent triangular bands sum to exactly 1.0 between their peaks)
  is the strongest sanity check available for a hand-rolled filterbank.

- **numpy's default float dtype is `float64`, and a fixed-width binary blob writer that doesn't
  force `float32` before serialising silently doubles the byte width** — reading it back with
  `np.frombuffer(data, dtype=np.float32)` then returns a vector of double the intended length,
  filled with garbage reinterpreted bytes, with no exception and no NaN. Any function
  serialising a numpy array to a fixed-width column must explicitly cast (or refuse) before
  writing.

- **A model with no reference implementation to diff against cannot be verified by
  "stability + no NaN" alone — both are necessary and nearly useless on their own.** A verification
  suite needs at minimum: **spread** (a badly mis-scaled input collapses every output to one
  point — check the maximum off-diagonal similarity isn't suspiciously high), **structure** (two
  halves of the *same* item should score more similar to each other than to the *strongest*
  cross-item match — check that ordering holds), and **sensitivity** (a deliberately wrong
  preprocessing convention must produce a measurably *different* result — if it doesn't, the
  check isn't actually exercising the thing it claims to verify).

- **A raw cosine-similarity gap between two vector spaces of different shape is not directly
  comparable, and comparing raw gaps can reverse the correct verdict.** One space can be
  uniformly "wider" (larger raw similarity differences everywhere) purely by construction — e.g.
  a centred, z-scored space vs. an anisotropic cone with everything crammed into a narrow angular
  range — and the wider space will win any raw-difference comparison regardless of which space is
  actually better at the task. Divide by the population's own spread (a gap-over-sigma / z-score
  style comparison) before judging two differently-normalised spaces against each other. More
  generally: any gate criterion that isn't invariant to the shape/scale of the thing it measures
  isn't measuring the thing it claims to compare.

- **A module-level "current configuration" context manager (`with config.using(PROFILE): ...`)
  swaps *process-wide* globals, not thread-local state.** Entering a second, different profile
  from a worker thread while another thread still has one active is a real hazard the moment any
  multi-threaded work (e.g. parallel decode workers) touches config-dependent code; guard by
  raising rather than silently interleaving two configurations' state.

- **A "what config is currently active" reader implemented by inspecting *live* globals, instead
  of a value frozen at the moment a context was entered, can report the wrong answer from inside
  a nested context** — and if that reader also feeds a reentrancy guard (comparing "the config I'm
  about to enter" against "the config already active"), two calls with genuinely different
  intended configs can compare equal and the guard silently lets an illegal nested switch
  through. Freeze the comparison value at entry time, not at read time.

- **Verifying a specific model checkpoint's preprocessing convention against the wrong published
  default produces a plausible, non-NaN, silently wrong result.** A model family that offers
  multiple filterbank/normalisation conventions gated by an internal flag (e.g. htk vs. slaney,
  selected by a checkpoint's declared truncation mode rather than the library's overall default)
  needs the *specific checkpoint's* convention verified, not the library default — a mismatched
  mel convention alone shifted a cosine similarity result by +0.49 in this repo's testing.

- **Batched GPU matrix reduction (cuBLAS) is only *cosine*-stable across batch size, never
  *bitwise*-stable — CPU inference is bitwise-reproducible, GPU is not.** cuBLAS varies its
  reduction strategy by batch dimension, so the same input batched differently on GPU produces
  numerically different (though extremely close — measured max Δ ≈ 2.5e-4, pooled cosine
  ≈ 0.9999994) output. A cross-backend consistency test needs two separate tolerance tiers, not
  one shared assertion of exact equality — and a `batch_size` value used differently per backend
  must never be a function *default* argument (the same evaluated-once-at-import family above);
  it silently ran a GPU backend at a fraction of its real throughput in early testing here.

- **An ONNX Runtime GPU execution provider that `pip install`s successfully is not necessarily
  *loaded*.** The CUDA shared libraries can land in site-packages without being on the dynamic
  loader's search path, causing a completely silent fallback to the CPU provider — no error, no
  warning, just roughly 20× slower with the only symptom being "this is taking a long time."
  `onnxruntime.preload_dlls()` (call it explicitly if the attribute exists) fixes the load path;
  always log which execution provider actually resolved so a silent fallback is visible.

- **`onnxruntime` and `onnxruntime-gpu` cannot coexist — they install into the same package
  directory**, so uninstalling one after the other has been installed deletes files the still-nominally-installed
  one depends on. Pick one per environment; don't `pip install` both in sequence expecting the
  second to layer on top.

- **A verification/check-set pinned to literal file paths self-disables *silently* the moment the
  underlying data layout changes** — every check gated on those specific paths existing quietly
  reports "not applicable" rather than failing, and a test harness reporting an overall summary
  (e.g. "5/8 checks PASS") can look green while having verified nothing about the checks that
  matter most. Any fixture-path-dependent check needs to *fail loudly* when its fixtures are
  missing (given the surrounding data source is otherwise reachable), never silently skip.

- **A CIFS/SMB network mount is very likely the actual bottleneck for any bulk file-processing
  job, well before CPU/FFT/model cost becomes relevant — measure wire throughput before assuming
  compute-bound.** Measured on this project's LAN: a single decode stream sustains roughly
  85–96 MB/s regardless of local CPU headroom. The correct shape for a bulk job under this
  constraint is **parallel readers feeding one serial compute session**, not parallelizing the
  compute side — giving both stages many threads contends for the same fixed wire budget for no
  additional throughput.

- **Hostile real-world filenames (`!!!`, `again&again`, `[24B-96kHz]`, embedded apostrophes) break
  naive shell command construction.** Any subprocess invocation over user-library file paths must
  pass an **argv list**, never a shell string, and never `shell=True` — this bit during initial
  probing and again in an SVG renderer, where an unescaped `&` in a path produced XML that failed
  to open at all.

## Docker, deploy & infra

- **A single-*file* Docker bind mount pins to the file's original inode, and `git reset --hard`
  swaps the inode — so `nginx -s reload` (which re-opens the same mount) silently keeps serving
  the *old* config content even though the file on disk is new and `nginx -t` against the on-disk
  file passes.** The tell: a new `location` block returns the wrong upstream even though `grep`
  against the on-disk file shows the block is there. Fix is always `docker restart <container>`
  (which re-resolves the mount), never `nginx -s reload`, after any config change delivered via
  `git reset --hard`. This suite's `standalone-nginx` config is a bind mount from the checkout for
  exactly this reason, and the deploy pipeline restarts rather than reloads.

- **"The Post-Init script exists and is enabled" is not proof a TrueNAS user's `docker` group
  membership actually took.** The init hook that runs `usermod -aG docker <user>` at boot can race
  the Docker service's own creation of the `docker` group, landing the user in a group that gets
  regenerated moments later. Diagnose on the *effect* (`getent group docker`, or `id` inside a
  freshly-opened SSH session) never on the script's configured existence — and because group
  membership only takes effect in a *new* login session, re-`ssh` before concluding anything about
  docker access. TrueNAS middleware also flatly refuses `user.update` against the builtin `docker`
  group (`EINVAL`), so the one-shot recovery when the boot hook hasn't fired is a throwaway root
  cronjob: create it running the `usermod` command, run it once, delete it — without waiting for a
  reboot.

- **An admin-gated edge means an unauthenticated external request against an app's "public"
  endpoint always redirects to login — a 302 there proves nothing about whether the route itself
  is broken.** Verify application behaviour from *inside* the running container instead (e.g.
  `docker exec <container> node -e 'fetch("http://localhost:<port>/api/...")...'`), which speaks
  to the app directly without the edge's own auth gate in the way.

- **A deploy script that copies itself to a temp location and re-execs *before* running
  `git reset --hard` always runs the *pre-pull* version of its own logic against the *freshly
  pulled* configuration.** A single commit that changes both a config file (e.g. nginx includes)
  and the deploy logic that validates that config can pass everywhere except the one place it
  matters, because the validator that actually runs during that deploy predates the fix. Recovery
  is simply re-running the deploy once more — the checkout is now on the commit whose logic
  matches its own config.

- **A shared reverse proxy serving both a production and a staging environment from *one*
  checkout means a staging-only config change can affect production traffic**, and conversely a
  production deploy must never validate or restart that shared proxy using production's own
  checkout — if the proxy's config is bind-mounted from staging, a "prod deploy sees an nginx
  diff" situation is validating and restarting the shared edge with an *unvalidated-this-run*
  staging config, blipping every site including ones with no relation to the change. Gate
  nginx management on an explicit flag per deploy target, not on "did this checkout's nginx
  files change."

- **A static asset served through both an app container and a reverse proxy needs its ROUTE
  and its CONTENT verified as two independent things — rebuilding the image alone doesn't fix a
  routing problem, and fixing routing alone doesn't ship new content.** When a URL falls through
  to the wrong handler (an admin-gated portal instead of an intended public page), check whether
  a *neighbouring* static path on the same origin still serves fresh content: if it does, the
  live nginx config is stale (needs a restart, not a rebuild); if it doesn't either, the image is
  stale (needs a rebuild).

- **A blanket SPA fallback (`app.get('*') → index.html`) combined with a browser-cached, stale
  `index.html` answers a missing hashed asset with the HTML shell at `200`, and the failure has
  no visible network error at all.** A content-hashed Vite build's `index.html` is the only file
  that knows the *current* asset filenames; if a browser has an old cached copy of it (naming
  asset hashes that no longer exist on the server) and the server's catch-all serves `index.html`
  for *any* unmatched path including `/assets/*.js`, the browser receives `200 text/html` for a
  request it expected JavaScript from, refuses to execute it as a module, and the page renders
  **blank** — no failed request, no console error pointing at the cause, just a column of
  200-status entries in the access log where a 404 would have been the honest answer. Fix, live
  in `packages/weave/server/spa.js` (`serveSpa()`, used by BeigeBoard/PapyrOS/KourOS, with a
  twin in `apps/ordeck/nginx.conf`): the entry document is served `Cache-Control: no-cache`
  (always revalidated) while hashed assets get `public, max-age=31536000, immutable`, and a
  missing asset under `/assets/*` returns a **hard 404** rather than ever falling through to the
  HTML shell — so a stale client fails loudly (a 404 in the console) instead of silently
  rendering nothing.

- **Rate-limiter middleware mounted with `app.use(path, limiter)` applies to every HTTP method by
  default, including safe `GET` requests — not just the credential-guessing `POST` attempts a
  login limiter is meant to budget.** A limiter meant to slow down password-guessing on
  `POST /auth/login` will also count every plain page-load `GET /auth/login` against the same
  budget, and once it's spent, the limiter's default handler answers the **page itself** with a
  raw JSON `429` body for the rest of the window — turning "someone mistyped their password a few
  times" into "the sign-in page is broken for everyone on that IP for 15 minutes." Fix, live in
  `apps/jkauth/src/app.js`: the limiter's `skip` option exempts safe methods
  (`SAFE_METHODS.has(req.method)`), and its `handler` re-renders the actual login page with a
  wait message for HTML callers instead of a bare JSON error.

- **An nginx `location /<id>/` block (with a mandatory trailing slash) does not match a request
  for `/<id>` with no trailing slash** — the bare path falls through to whatever block matches
  next, commonly a catch-all `location /`, which for an admin-gated portal silently serves an
  unrelated page (the portal's own login/home) instead of 404ing, redirecting, or matching the
  intended app. Every generated per-app block in this suite carries this guard by construction;
  a hand-tuned block (like the `/jkauth` → `/auth/dashboard` alias in `infra/nginx/standalone.conf`)
  has to add it explicitly, and it's easy to forget on a bespoke, non-generated route.

- **A Docker bind mount never checks that its source path actually has content.** Two paths that
  differ only in an extra path segment (e.g. a share that mounts locally at `/mnt/Luna` but is a
  subdirectory `/mnt/Luna/Luna` on the server actually exporting it) are both "valid" as bind-mount
  sources — if the compose file's source path is the *empty* one, Docker silently auto-creates it
  as a plain directory, the mount "succeeds," the app scans it, finds nothing, and reports success.
  Nothing anywhere errors: not the mount, not the scan, not the app's health check. The only tell
  is the resulting *feature* (a media library, a data source) being empty for a reason that looks
  identical to a dozen other misconfigurations. Verify a bind mount by checking what's actually
  inside the container (`docker inspect <c> --format '{{range .Mounts}}...'` plus a directory
  listing), not by trusting that the mount didn't fail.

- **`express.static`'s `dotfiles` option defaults to `'ignore'`, so anything under a
  `.well-known/` directory (required for platform verification files like Android's
  `assetlinks.json` or ACME challenges) never matches static file serving at all** — it falls
  through to whatever catch-all handles unmatched routes, commonly an SPA's `index.html`, and
  returns **`200 text/html`** instead of the expected JSON. The consuming platform gets no error
  from this; it just fails verification silently, with a symptom (e.g. a persistent browser URL
  bar in what should be a standalone installed app) that gives no hint the cause is a static-file
  server default. Generate/serve `.well-known/*` paths explicitly rather than relying on a
  generic static-file mount to pick them up.

- **A comment must speak the language of the line it sits on — and this repo mixes three per
  file.** Backend files embed SQL in JS template literals, so a single line can be JavaScript,
  SQL, or the boundary between them. All three failed at PARSE time during the 2026-08-27
  wire-time change: a `// …` comment appended inside a `CREATE TABLE` template literal is a SQL
  syntax error; the same comment appended *after* the literal closes (`` `); ``) is correct JS
  and wrong if you meant SQL; and an SQL `-- …` comment that quotes a table name in **backticks**
  ENDS the enclosing template literal, producing `SyntaxError: missing ) after argument list`
  pointing at the top of the block rather than at the comment. Rules: `--` inside the literal,
  `//` outside it, and never a backtick in either.

- **`check:text` scans TRACKED files, so a brand-new file passes the gate until you `git add`
  it.** `Documentation/TRAPS.md` was written with a raw NUL byte in it — in the passage
  documenting the NUL-byte trap — and the full gate went green because the file was still
  untracked at that moment. It failed on the very next run, after staging. **Stage first, then
  run the gate**, or a new file's first gate result is meaningless.

## git & shell

- **`git checkout <file>` over uncommitted work-in-progress discards it — there is no undo.**
  This has happened more than once in this project's history, always while trying to "just look
  at" or reset one file mid-session. Before any destructive git operation, stash or copy the file
  first, even (especially) when it feels like a quick throwaway check.

- **Backticks inside a `git commit -m "…"` string get shell command-substituted** — the shell
  tries to execute whatever's between the backticks and splices its output (or an error) into the
  commit message, silently mangling it. Avoid backticks in commit messages, or pass the message
  via a heredoc/file.

- **A raw NUL byte written into a source file (most often from an automated tool's mishandled
  escape sequence, e.g. `'\0'` meant as a sentinel character) makes that file *binary* to both
  git and grep.** `git diff` reports "Binary files differ" — completely unreviewable in a normal
  diff — and a plain `grep -r` silently **skips** the file rather than erroring. Because nearly
  every conformance gate in this suite is implemented as a text scanner, a NUL byte is invisible
  to every one of them at once. Always write control characters as escape sequences
  (`'\u0000'`/`\0` in source, never a literal byte); this repo guards against it with a dedicated
  text-purity scan (`pnpm check:text`) that specifically catches binary-looking tracked files. As
  a reflex: check `git diff`/`git status` for a "binary file" report after any large automated
  edit.

- **Bash cannot hold a NUL byte in an argument at all** — a NUL embedded in a search pattern or
  a commit message silently truncates the argument at that byte, eating everything after it with
  no error. Anything that might touch a NUL byte (constructing a `grep` pattern, assembling a
  commit message programmatically) needs a language with real string types (e.g. a small Node
  script), not a bash one-liner.

- **`pkill -f "<pattern>"` matches against the *invoking shell's own command line*, which
  contains the literal pattern text you just typed** — it can and will kill your own current
  shell/process tree before it reaches the intended target. Prefer `kill $(pgrep -f
  '<pattern>')`, and if the pattern would still match your own invocation, obfuscate one
  character (e.g. `serve[r].js` instead of `server.js`) so it can't self-match.

- **`.gitignore` only treats `#` as a comment character when it is the *first* character of the
  line.** A trailing comment after a real pattern (`.cache/   # note`) becomes part of the pattern
  itself and matches nothing — the ignore silently fails with no warning from git. Keep every note
  on its own line in a `.gitignore`.

## This repo's shape

- **A JWT `sub` claim must be a string, and this suite's tokens weren't always one.**
  `python-jose >= 3.4` and `PyJWT >= 2.10` both started enforcing RFC 7519's "SHOULD be a string"
  rule and reject a numeric `sub` outright with `JWTClaimsError("Subject must be a string")`.
  jkAuth's Node `jsonwebtoken` verifier tolerated a numeric `sub` (the raw SQLite integer user id)
  without complaint, so most of the suite never noticed anything wrong — until an *unpinned*
  `python-jose` in `jkos-deploy/requirements.txt` auto-upgraded past the enforcing version on a
  routine rebuild, and every otherwise-valid token started 401ing at exactly one Python
  consumer. The failure mode was a redirect **loop**, not a clean error: nginx's own admin gate
  passed the request through (it doesn't decode the token), the Python backend rejected it, the
  client's auth layer refreshed and retried into the identical rejection, repeatedly. Fix at the
  source: `apps/jkauth/src/tokens.js` mints `sub: String(user.id)` (confirmed current — every mint
  path, including the 2FA-pending token). A `verify_sub: False` escape hatch existed in
  `jkos-deploy/jkos_auth.py` while the source fix rolled out and has since been removed — its own
  comment records this: *"the verify_sub:False workaround for the numeric-sub incident is retired
  now."* `jkos-deploy/requirements.txt` still pins `python-jose[cryptography]>=3.3.0,<3.6.0`
  deliberately, so a future unpinned bump can't reintroduce the same surprise from a different
  angle. The generalisable trap: **a JWT claim that one verifier tolerates today is not
  guaranteed to be tolerated by the next language/library that has to read it** — mint identity
  claims as strings from the start rather than relying on whichever verifier you tested against
  being permissive.

- **`music/` lives outside the pnpm workspace on purpose.** `pnpm-workspace.yaml` globs only
  `apps/*`, `apps/*/backend`, and `packages/*` — `music/` matches none of them, has its own
  `requirements.txt` (hard-capped at `numpy` + `onnxruntime`, nothing else — see `RESET.md` §0),
  and runs its own `unittest`-based test suite independent of `pnpm test:contracts`. **A green
  `pnpm test:contracts` says nothing about whether `music/`'s own tests pass.** Run
  `./.venv/bin/python -m unittest discover` inside `music/` to check it.

- **A `hub.css` edit is not "done" until two generated token mirrors *and* the `/design`
  reference page are regenerated** — `pnpm --filter @jkos/jkauth sync:tokens` (jkAuth is
  static-served with no bundler, so it `@import`s a committed copy of hub.css rather than
  building from the source package), `node jkos-deploy/scripts/sync-tokens.mjs` (same reason,
  different consumer), and `node apps/jkauth/scripts/build-design-page.mjs` (splices the current
  hub.css verbatim into the live style-guide page at `/design`). `pnpm check:design` fails a
  build if a hub.css class isn't demoed on that page, which catches *missing* documentation — it
  does not catch a mirror that's gone stale relative to the real hub.css.

- **A new `include` file referenced from `infra/nginx/standalone.conf` must be mounted into BOTH
  the live nginx compose *and* the deploy pipeline's own pre-flight `nginx -t` validator, or a
  deploy that changes nginx config takes the shared edge down** — the validator runs a throwaway
  container against only the files it's told to mount, and a config referencing an unmounted
  include fails `nginx -t` (or, worse, is invisible to the pre-flight check and only fails at
  restart time). `infra/scripts/lib-deploy.sh`'s `validate_nginx` derives its mount list from
  `standalone.conf`'s actual `include` directives specifically so this class of drift can't
  recur — but any *new, separate* generated-config file introduced outside that mechanism needs
  the same wiring done by hand in both places.

- **The suite's single shared `standalone-nginx` container serves *both* production and staging,
  with its config bind-mounted from the STAGING checkout, never production's.** Editing nginx
  behaviour that affects production still means editing and deploying the *staging* repo copy of
  `infra/nginx/`; a production-only deploy that happens to touch `infra/nginx/` in its own
  checkout has no effect on the running edge at all, because that checkout isn't what's mounted.

- **LazurOS's Node backend registers every route at its *full* edge path (e.g.
  `/api/lazuros/health`), unlike every other peer, which registers routes relative to a prefix
  nginx strips before proxying.** A generic "strip prefix, proxy to service root" nginx/vite-dev
  rule that works for every other app 404s every LazurOS route. `infra/nginx/gen-nginx-weave.mjs`
  special-cases LazurOS to **preserve** the `/api/lazuros` prefix rather than strip it — verify
  this convention (documented directly in the generator's own comments) before assuming a new
  peer app follows the same stripping rule every other one does.
