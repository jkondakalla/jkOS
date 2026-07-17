# jkOS — ToDo

The working backlog. **Completed work is summarized, not enumerated** — the task-level record
for a finished wave lives in the relevant `Documentation/*.md` (mostly ARCHITECTURE.md), so
this file carries detail only for **open and future** work. Gate (`pnpm test:contracts`) is
**green** as of 2026-07-16 (prober 0-drift, 93 ok). When a section finishes, fold a one-line
note into the right doc and delete it here.

Section numbering is stable: **§1 = LazurOS**, **§2 = PapyrOS** (other docs cross-reference these,
and the `6.5e` label). **§3 = the media primitive program** (new, 2026-07-13).
**VaultOS moved out** → [VAULTOS.md](VAULTOS.md) (parked; ZFS covers the need).

---

## ⚠️ Hard constraints a cold agent MUST know

- **Do NOT edit `apps/sylibos/`** — even in suite-wide sweeps. `bb`→`beigeboard`
  canonicalization never touches `sylib` spellings. (`services/plex-api/` and
  `services/recipe-api/` used to sit alongside it on this list; both were **deleted**
  2026-07-13 in the LazurOS cleanup — they were the last callers of the retired
  `/api/chat` proxy, and nothing deployed them.)
- **Suite scope** = BeigeBoard · jkAuth · jkDeploy · ORDECK · Weave · LazurOS · PapyrOS ·
  KourOS (the music app, §3 Wave 18).
- **The gate must stay green after every chunk:** `pnpm test:contracts`. The full
  command/gotcha catalog is [PRIMITIVES.md](PRIMITIVES.md) (pnpm-copy staleness, ORDECK
  build+preview not dev, nginx restart-not-reload, root Docker context, quoted repo path).
- `Documentation/` is the source of truth; when a doc disagrees with code, the code wins —
  update the doc.

---

## Done so far (summary — full detail in the linked docs)

- **7-wave upgrade program** (2026-07-06/07): 8 bugs, 8 architecture chunks, 16 testers;
  committed + pushed to `staging`. Record: [TESTING.md](TESTING.md) history capsule.
- **LazurOS Phases 0–6 + 8** built, unit-tested (71 backend assertions in the gate), and
  **committed** (`2156a19`, `750117b`) — code-complete, not yet exercised against live runtimes.
  [ARCHITECTURE § LazurOS](ARCHITECTURE.md#lazuros-the-ai-gateway). Remaining: §1.
- **PapyrOS Waves 1–7.3** live on staging: scaffold + suite wiring, library scanner/catalog,
  Range-streamed playback + download, iTunes metadata connector + auto-enrich, SPA + PWA, the
  6.x live-hardening batch (square covers, Firefox compat pipeline, genre chips, chapter
  progress, chapter-relative scrubber), and offline media (Cache/IndexedDB download +
  service-worker offline serving). [ARCHITECTURE § PapyrOS](ARCHITECTURE.md#papyros-the-audiobook-app).
  Remaining: §2.
- **`@jkos/player` Wave 15** (2026-07-14, uncommitted): the media primitive extracted from
  PapyrOS — pure timeline/queue core, `MediaBackend` seam (one impl for audio+video),
  generalized headless engine (six invariants preserved); PapyrOS migrated with zero
  behavior change (engine file 756→~200 adapter lines, `position.ts` deleted). Record:
  [PLAYER_PARITY.md](PLAYER_PARITY.md) + [TESTING.md § Player](TESTING.md).
- **`@jkos/player` Waves 16 + 17 + 20** (2026-07-15, uncommitted): services + UI kit +
  factory, the four backend bricks (+ `@jkos/files`), and the Wave-20 suite shells — every
  §3 item except the music app (18, needs the id confirmed) and video (19, parked). Full
  record folded into [ARCHITECTURE.md](ARCHITECTURE.md) (Shared packages + PapyrOS
  sections); the DONE capsules below carry the one-breath summaries.
- **KourOS — §3 Wave 18 complete** (2026-07-15/16, uncommitted): the music app, all six
  items — scaffold, backend on the bricks (zero brick changes), library UI, `musicPlayer()`
  as the primitive's consumer #2, `gaplessDual` crossfade backend, playlists. Record:
  [ARCHITECTURE.md § KourOS](ARCHITECTURE.md) + [PLAYER_PARITY.md](PLAYER_PARITY.md) §3.
  Remaining: §3 Wave 19 (parked) + the `MUSIC_DIR` mount (Jag, deploy-time).

---

## 1. LazurOS go-live

Phases 0–6 **and 8** are built, tested, committed; nothing is mid-edit. Bring-up runbook:
[LAZUROS_STARTUP.md](LAZUROS_STARTUP.md). Architecture:
[ARCHITECTURE.md § LazurOS](ARCHITECTURE.md).

**LazurOS constraints:** no hardware facts in code (model tags, IPs, MACs, quantizations live
in a mounted `deployment.json`, never literals); every swappable piece is a
`createXProvider(config)` factory; prompts/model tags load from node-local
`prompts.json` / `models.json`, never inline strings.

### 1a. Internal code changes — **DONE 2026-07-13 (uncommitted)**

All four landed; record folded into
[ARCHITECTURE.md § LazurOS](ARCHITECTURE.md#lazuros-the-ai-gateway) (Gate hardening): the
19-assertion Python worker smoke rides the gate (skip only when python3 is absent — import
failures FAIL, worker.py is stdlib-only by mandate); both `deployment.example.json` and
`deployment.jag.json` validate under test; the `jobs` dataset declares **and** enforces
`capability` + `since` (exclusive `gt` over `updated_at`); worker.py's dangling `LAZUROS.md`
citations repointed. Flagged, parked, suite-wide: second-resolution `updated_at` stamps (the
same-second `since` collision BB fixed with ms-ISO in migration 8) still live in the shared
`defineCollection` brick, PapyrOS, and LazurOS.

### 1b. Unblockers needing Jag (content + hardware, not code)

| Item | Blocks | Notes |
|------|--------|-------|
| **`prompts.json` content** | live e2e of everything | **Top unblocker.** Node-local, per worker. Placeholders are **not free** — they must match the capability's declared body fields in `backend/docs.js`: `parse-task`→`{text}`, `breakdown-goal`→`{goal_text}`, `parse-document`→`{content}`, `widget-generate`→`{description}`, `query`→`{text}`. See the import-shape constraint below. |
| **`models.json` content** | any worker start | Node-local, flat `{capability: model-tag}`. Template ships with literal `REPLACE_WITH_*` values; `worker.py` raises on a missing capability. |
| Emily static IP + MAC | Phase 5 | Fill **3 placeholders** — `TODO_EMILY_MAC` ×1, `TODO_EMILY_IP` ×2 — in `deployment.jag.json`, then `cp` to `deployment.json` (gitignored, bind-mounted `:ro`). `computeBackend.js:34` hard-throws on a bad MAC, and a test asserts exactly that. DHCP reservation + WoL in BIOS **and** NIC + idle-shutdown. |
| Luna Ollama Vulkan confirm | Tier 0 | RX 560 is Polaris — ROCm dropped it, so **Vulkan, not ROCm**; pass `/dev/dri`. `ollama ps` must show the GPU. If it shows CPU, tier 0 is fake. |
| Whisper + Piper servers | Tier 0 STT/TTS | `:8000` (OpenAI-compatible `/v1/audio/transcriptions`) / `:5000`; source the GLaDOS Piper voice. |
| DDGS sidecar (or SearXNG) | Tier 1 | Provider ships both factories; Jag's config points at ddgs (`:8001`). **Tier 1 is web search, not Ollama.** |
| jkAuth env enrollment | delegated write-back | `JKOS_SERVICE_CLIENTS=lazuros:<secret>:beigeboard:write` **and** `JKOS_DELEGATION_CLIENTS=lazuros`. Both required — delegation supplies only the *who*; the client must separately hold the scope. Unset ⇒ write-back **silently cannot run**. |

**The import-shape constraint (load-bearing).** `parse-task` and `breakdown-goal` results feed
straight into BeigeBoard via `lib/writeback.js` → `POST beigeboard/import`, which does a bare
`JSON.parse` and throws on anything else. BB's importer requires `{items:[…]}` (or a bare array),
each item needing a `title`; children nest via `children`/`kids`/`subtasks` and **must be a
non-empty array** — an explicit `children: []` reads as a leaf task, not an empty goal. So the
`breakdown-goal` prompt must emit nested children and must never emit `children: []`.

### 1c. Phase 5 — Tier 2 wiring *(no code)*

Fill Emily's MAC/IP, verify `wake → probe → claim → round-trip` through the existing
`createWolBackend`. Full state walk: `PENDING → PENDING_WAKEUP → IN_PROGRESS → DONE|FAILED`.

### 1d. Phase 7 — BeigeBoard AI, rebuilt on LazurOS `[opus]`

**The old surface is GONE (2026-07-13 cleanup), so there is no longer a "cutover" and no
"don't strip it early" constraint.** The removal already happened, because the thing being
protected was already dead: BB's `ai.js` called `POST /api/chat`, an endpoint the rebuilt
LazurOS does not serve, and `BB_AI_ENABLED` was never set in any compose file. Deleted:
`backend/src/routes/ai.js`, its `discovery.js` capabilities (`parseTask`, `breakdownGoal`),
the `LAZUROS_*` / `BB_AI_ENABLED` config + env keys, the TodayView "✦ AI" button, and the
mock-LazurOS half of `items.smoke.mjs` (which now asserts `/api/ai/*` → **404**, so the
surface cannot quietly come back).

What remains is **new work, not a migration** — and it still needs a design pass:

- **The shapes are incompatible.** The old path was synchronous (POST → parsed JSON inline).
  LazurOS is asynchronous (`202 {job_id}` → poll the `jobs` dataset). So BB's AI has to grow
  **job-polling UX** (pending state, progress, failure surface). **Nobody has designed this.**
- **The write is LazurOS's, not BB's.** A `parse-task` job commits through delegated write-back
  into BB's existing `createItem` / `importItems` as the acting user. BB does not call a model
  and does not need an AI capability of its own — which is why `discovery.js` now declares none.
- **Do this AFTER the staging console proves the round-trip** (§1f), not before.

### 1e. Phase 8 — ORDECK widgets. **DONE + committed (`750117b`) — awaiting Jag's publish click.**

`apps/lazuros/widgets/lazuros-query.json` + `lazuros-jobs.json` + `README.md` with the exact
Workshop publish steps. Validated via the real `check-hud-doc.mjs` + a lossless `nodeToEn`/`enToNode`
round-trip. Zero ORDECK code changes. **Remaining work = a human clicking Publish twice in the
Workshop as admin.** Two recorded dialect gaps (no command-result capture, no eq-binding for
status→tone) are deliberate and non-blocking.

### 1f. The staging test console + the edge-prefix fix. **DONE 2026-07-13 (uncommitted).**

`https://staging.jkos.net/LazurOS` — admin-gated. A static page the State node serves
(`backend/console/`, no build step) that lists the capabilities **derived from
`/api/lazuros/capabilities`**, submits one, and polls the `jobs` dataset while it walks
`PENDING → PENDING_WAKEUP → IN_PROGRESS → DONE|FAILED`. It uses only the public HTTP contract a
peer app uses, so a green run there is evidence about the real path. **This is the surface to
prove Phases 5 + 1b on — do it before §1d.**

Two bugs it exposed, both fixed:

- **`[BUG]` The edge 404'd every LazurOS route.** The nginx block proxied to
  `host.docker.internal:8080/` — a trailing slash, which **strips** `/api/lazuros` — but the
  State node registers its routes at their FULL edge paths (`/api/lazuros/health`, and every
  path in `docs.js`). Nothing LazurOS advertised was reachable, and no test could see it:
  the server was right, the conf was right, only the *pair* was wrong. Fixed in the generator
  (prefix preserved), the ORDECK vite dev proxy (same stripping bug), and pinned from **both**
  ends — the prober now derives strip-vs-preserve from each app's capability paths and compares
  it to the conf (`90-nginx-coverage`), and `worker-e2e` asserts the stripped path 404s.
- **`[BUG]` Health never reported compute.** ORDECK's systems panel branches on
  `compute_online === false` ("gpu asleep"), but `healthHandler` only ever returned
  `{status, service}` — so the row could never fire. `healthHandler(service, details?)` grew an
  opt-in details seam (uniform keys still first, a throwing `details()` degrades to the base
  payload); LazurOS reports `compute_online` + a per-backend map, probed in parallel (500ms
  each) and cached 5s so a polling HUD can't stampede a sleeping node.

---

## 2. PapyrOS remaining

**PapyrOS** (`papyros`, port 3010): fully-native multi-user audiobook app — own scanner/catalog/
streaming, per-user progress gated by jkAuth; sanctioned external calls = the iTunes Search API
(live) plus the approved-but-unbuilt Open Library + Audible/Audnexus expansion (6.5e). Never a
client of Audiobookshelf.

**Execution rules.** Waves run in order. The gate (`pnpm test:contracts`) must be green after
every wave; the app must also `pnpm --filter @jkos/papyros build` clean. Tasks are sized for one
sub-agent pass — sonnet by default; `[opus]` where flagged.

**Shared crib — cold-start facts every new-app/wave task agent needs**

- Scaffolder: `pnpm new-app <id> --name "<Name>" --port <port>` (`scripts/new-app.mjs`) emits
  `apps/<id>/**`, patches `packages/suite-manifest/apps.js` + `apps.d.ts` (AppId union — gated
  parity check), adds the root **prod** `docker-compose.yml` include, and regenerates the four
  nginx confs. It does **not** patch the root `docker-compose.staging.yml` (manual) and
  defaults `datasets:true`.
- Backends are **CommonJS** — no ESM-only deps without a dynamic `import()` wrapper.
  `better-sqlite3` comes with the scaffold. Editing any `packages/*` ⇒ rerun `pnpm install`
  (the `.pnpm-copy` staleness rule).
- Canonical `server.js` middleware order: weaveCors → identity gate (public:
  `/api/capabilities`, `/api/datasets`) → `weaveWriteGate({scope:'<id>:write'})` → health →
  serve docs → route mounts → SPA fallback.
- Weave datasets return **bare-array rows**; declared filters == enforced filters — reuse
  `buildItemFilters`/`filterSpec` from `@jkos/weave/server`. `defineCollection` /
  `defineConnector` (lego bricks D1/D2) live there too.
- Frontends: `injectJkOSTheme` (`@jkos/design`), `authFetch` (`@jkos/auth-client`),
  `useBreakpoint` + primitives (`@jkos/ui`), ORDECK-style `AuthGuard` redirect login. Mirror
  the vite `commonjsOptions.include` CJS fix (`auth-middleware`, `suite-manifest`); verify via
  **build + preview**, not vite dev.
- Tests: author via the **new-tester** skill and chain into `pnpm test:contracts`.
- Library path: `/mnt/Luna/Luna/Plex/Audiobooks` on the TrueNAS host — NOT `/mnt/Luna/Plex/...`.
  The "Luna" SMB share is a dataset nested one level inside the "Luna" pool, so the
  pool-root-looking path silently bind-mounts an empty dir (caught 2026-07-09). TrueNAS files are
  uid/gid `1000:1000`. Data dirs: `/mnt/Luna/Backends/{Production,Staging}/<id>-data`. nginx on
  deploy: **restart, not reload** — but recreate if the mount set changed (bind-mount inodes).

### PapyrOS — open items

- [ ] **6.2 Live verify (needs Jag's own login).** Already confirmed via direct host access:
      boot scan cataloged 18 real titles, `/health`/`/api/capabilities`/`/api/datasets` shapes
      correct, `/papyros/` routes live behind the staging edge gate. Still needs a real
      authenticated session (no service token substitutes for "two independent users"): jkAuth
      login → `Range: bytes=0-1023` → `206`; two users → independent resume; match one
      thin-metadata book; add a bookmark; download a file; install the PWA. Then
      `pnpm prove --live https://staging.jkos.net --token <admin jwt>` for a clean signal
      (unauthenticated reports expected `drift` because the whole staging edge is
      `auth_request`-gated), suite-health, and promote (prod blocked on DNS).
- [ ] **6.5e Multi-source metadata `[FEAT-P]`.** Jag approved **Open Library + Audible/Audnexus
      + iTunes**, all keyless: provider registry, merged/deduped candidates with per-source
      badges, field precedence (narrator/series/chapters = audnexus; description = audnexus > OL
      > itunes; genres = union; cover = audnexus > itunes600 > OL-L), cross-source agreement
      boosts auto-apply confidence. **NOT BUILT** — two build agents were killed by session
      limits (2026-07-10); the spec here is complete and ready. Single-source iTunes enrichment
      meanwhile runs automatically (`PAPYROS_AUTO_ENRICH=1`). **§3 17.6 landed 2026-07-15**
      (`defineConnector.call()`, match.js's duplicate deleted) — this item is now UNBLOCKED:
      new provider connectors compose through the same `call()` surface.
- [ ] **7.2 Offline write queue `[FEAT-P]` `[opus]`.** Queue progress/bookmark writes while
      offline; reconcile on reconnect via the collections' `?since=` delta cursor,
      last-write-wins on `updated_at`. The 7.1 cache + 7.3 SW serving it builds on are live;
      `src/offline/index.ts` already reserves the seam. **Belongs in `@jkos/player` services
      (§3 Wave 16) once that exists — all three players want it.**
- [ ] **8.1 Book club `[FEAT-P]`.** Club views over `clubs`/`club_members` + `progress`:
      current pick, members, who's-caught-up. Needs a bespoke membership-gated read route —
      scoped collections hide other users' rows (flagged when 3.1 was built). Ship the four
      default fields (name/description/current-pick/members).
- [ ] **8.2 ORDECK "continue listening" widget `[FEAT-P]`.** A published WidgetSpec via the
      Workshop reading `weaveClient('papyros')` books + progress — no ORDECK code changes (same
      pattern as LazurOS Phase 8).
- [ ] **8.3 Parked polish** (record only, build on request): SSE/WebSocket "now listening",
      LazurOS auto-match, speed presets, bookmark export.

---

## 3. Media primitive program — `@jkos/player` (Waves 15–20)

**The ask (Jag, 2026-07-13):** one player primitive with seams per app — a video player
(Plex/Jellyfin class), a very good music player (Plexamp floor, Spotify ceiling), and the
audiobook player PapyrOS already has. Backend mostly shared, because it mostly does the same job.
Design spec: [PLAYER_PARITY.md](PLAYER_PARITY.md).

### Decisions (Jag, 2026-07-13) — these override the old doctrine *for the player only*

| Decision | Choice | Consequence |
|---|---|---|
| **Extraction order** | **Extract first; PapyrOS proves it** | Build `@jkos/player` from PapyrOS's engine, migrate PapyrOS onto it with **zero behavior change**, then build music as consumer #2. Supersedes the "second consumer proves the seam" rule *here* — the seam is already enumerated and PapyrOS is the hardest case. |
| **Topology** | **Three apps, one primitive** | `papyros` (3010) + a music app + (later) a video app. Each keeps its own scope / edge / DB. |
| **Video v1** | **Parked** | Build the seams so nothing blocks it; don't build a video app yet. |
| **Backend sharing** | **Shared bricks, separate DBs** | Each app keeps its own SQLite + schema; shared *bricks* generate them. |

### The insight the program rests on

PapyrOS's position math **does not model a book.** It models *N sources concatenated into one
global timeline, with a gap-free list of nav points over it* (`buildTimeline` / `locate` /
`toGlobal` / `navPoints` / `currentNav`) — no React, no network, pure math. Rename two types and it
is the media core. *(Wave 15 proved this: the math now lives verbatim in
`packages/player/src/core/timeline.ts`; papyros's `position.ts` is deleted.)*

- **Timeline** = ordered `MediaSource`s + a derived duration + `Segment`s over it.
- **Queue** = an ordered list of Timelines + a cursor + a policy (shuffle, repeat).

| Domain | Queue | Timeline | Segments |
|---|---|---|---|
| Audiobook | 1 item (the book) | N files concatenated | chapters |
| Music | N items (tracks) | 1 file each | *(none)* |
| Video — film | 1 item | 1 file (+ renditions) | chapter markers |
| Video — series | N items (episodes) | 1 file each | markers, skip-intro |

**PapyrOS already solves the hardest case.** Music is the *easy* one. What's missing is the outer
queue layer — which does not exist in any form today.

### What PapyrOS actually has (verified in code, not assumed; engine refs now live in `packages/player/src/engine/`)

- ✔ **MediaSession IS wired** (engine's `setMediaSession`, kept inline per 16.3) — metadata,
  play/pause, seek±, prev/next, `playbackState`. Only **`setPositionState` is missing** (the
  lock-screen scrubber is inaccurate without it). *An earlier note in this program claimed
  MediaSession was absent — it was wrong.*
- ✔ Rate presets (persisted), 5-mode sleep timer, bookmarks, debounced progress upsert with
  serialize-in-flight + skip-unchanged, the compat-recovery ladder, chapter-relative scrubber.
- ✘ **No queue.** `onEnded` advances *within* a book only. Nothing to shuffle, repeat, or autoplay.
- ✘ **No volume control.** Not in `PlayerApi` at all.
- ✘ **No gapless/crossfade.** One `<audio>`, `src` swap per file — structurally can't.
- ✘ **No play history.** Confirmed: no `history`/`plays`/`listens` table anywhere in the schema.
  `progress.last_played` (one overwritten timestamp per user per book) is the *entire* extent of
  "when did I listen". Nothing computes listening stats.

---

### Wave 15 — `@jkos/player` core + engine; PapyrOS migrates. **DONE 2026-07-14 (uncommitted).**

The bet paid: PapyrOS renders unchanged on the extracted primitive (its `usePlayerEngine.ts`
is a ~200-line adapter, `position.ts` deleted; `PlayerBar.tsx` untouched bar one import).
Record: [PLAYER_PARITY.md](PLAYER_PARITY.md) status capsule +
[ARCHITECTURE § shared packages / § PapyrOS player](ARCHITECTURE.md); tests:
[TESTING.md § Player](TESTING.md) (158 assertions in the gate). In-browser confirm
(autoplay veto, Firefox compat recovery, offline SW) rides on Jag's next staging session —
same checklist as the standing Wave-6 compat confirm.

### Wave 16 — player services + UI kit. **DONE 2026-07-15 (uncommitted).**

All seven landed. Record: [ARCHITECTURE § Shared packages / § PapyrOS player](ARCHITECTURE.md)
(the `@jkos/player` and `@jkos/ui` rows carry the per-item detail);
[PLAYER_PARITY.md](PLAYER_PARITY.md) §3; tests in [TESTING.md](TESTING.md). In one breath:
**16.1** `@jkos/ui` primitives polymorphic over `as` (`ComponentPropsWithoutRef<E>`);
**16.2** engine volume/mute (optional `volumeStorageKey`, papyros's audiobook bar deliberately
renders no volume control); **16.3** `useMediaSession` lifted to `@jkos/player/services` + the
missing `setPositionState`; **16.4** `createResumeCursor`/`useResumeCursor` in
`@jkos/weave/resumeCursor` — the engine's write path now delegates to it, zero behavior change;
**16.5** the offline write queue in `@jkos/player/services` (pure policies + IndexedDB storage +
runtime), wired by `apps/papyros/src/offline/writes.ts` (online path unchanged, synthetic
negative-id rows, `?since=` reconcile with LWW); **16.6** the `@jkos/player/ui` kit (PlayerBar
shell + stock controls + segment-aware Scrubber + QueuePanel + NowPlaying + SegmentList;
papyros's PlayerBar rebased markup-identical); **16.7** pure `createPlayer(spec)` factory +
audiobook/music/video presets (`videoPlayer()` stays `unbuilt: true` until Wave 19).

### Wave 17 — backend bricks. **DONE 2026-07-15 (uncommitted).**

All six landed. Record: [ARCHITECTURE § PapyrOS scanner / streaming / data model + § Shared
packages](ARCHITECTURE.md) (per-item detail); [PLAYER_PARITY.md](PLAYER_PARITY.md) §4; tests in
[TESTING.md](TESTING.md). In one breath: **17.1** `@jkos/files` (`rangeStream` + `containPath`,
own smoke in the gate); **17.2** `defineLibraryScanner` (whole ladder generic, `unit: 'dir'|'file'`
— the `'file'` shape is what 18.2's music tags need, proven with a different tag vocabulary in the
brick's own 47-assert hermetic test; papyros `scan.js` → ~90-line app config, zero behavior
change); **17.3** `defineMediaRoutes` + the pure `decidePlayback` engine (capability-driven and
explicit `?compat=N` modes over one app-supplied ladder; all five generation invariants pinned by
a text-scan gate; papyros `media.js` 590→213 lines, wire-identical); **17.4** append-only
`history` collection (`only: ['create']` knob added to `defineCollection`; papyros migration 9 +
a session recorder in the app adapter — one row per listening stretch, and the page-hidden close
REOPENS while still playing so screen-locked listening keeps recording, integration fix
2026-07-15); **17.5** `progress` UNIQUE `(user_id, book_ref)` + dedupe migration 8 + an
upsert-safe BEFORE INSERT trigger (closes the two-tab first-play race; also the server-side
backstop for the offline queue's find-else-POST replay); **17.6** `defineConnector` gained the
in-process `call()` read surface — `match.js`'s hand-rolled iTunes duplicate is deleted
(unblocked §2 6.5e and 20.4, the latter since consumed it).

### Wave 18 — the music app (KourOS). **DONE 2026-07-16 (uncommitted).**

All six items shipped (id `kouros`, port 3011 — Jag confirmed 2026-07-15): scaffold + suite
wiring (18.1), backend on the bricks with zero brick changes — `tracks` 'file'-unit scanner,
direct-play `defineMediaRoutes`, `playlists`/`history`(append-only)/`ratings`(UNIQUE+upsert
trigger from day one) (18.2, 118 gate assertions), the five-view library UI on the Wave-20
primitives (18.3), the `musicPlayer()` queue/transport as the primitive's consumer #2 (18.4 —
the queue-composition verdict + two engine gaps recorded), `createGaplessDualBackend`
gapless/0–12 s crossfade with the swap handshake (18.5, 91 assertions, papyros byte-untouched),
and playlists UI with `usePointerDrag` reorder (18.6). Record:
[ARCHITECTURE.md § KourOS](ARCHITECTURE.md) + [PLAYER_PARITY.md](PLAYER_PARITY.md) §3 status
blocks (incl. one known ms-scale stale-swap micro-race, noted not fixed). Still open, deploy-time,
Jag's: the real `MUSIC_DIR` mount (env + compose bind) and the staging compose bring-up.

### Wave 19 — video `[PARKED]`

Seams only for now. When it starts, the *player* is nearly free (15.2's `htmlMedia` already covers
`<video>`; `videoPlayer()` adds fullscreen, PiP, subtitle + audio-track pickers, quality picker).
**The real cost is the backend:** HLS segmenting + ABR ladder + seek-during-transcode, subtitle
extraction (embedded + external, forced/SDH), multiple audio tracks, VAAPI/NVENC hardware accel,
and thumbnail/BIF sprites for scrub preview. 17.3's decision engine is rungs 0–2 of exactly that
ladder. **Do not start without a scoping pass — this is easily larger than Waves 15–18 combined.**

### Wave 20 — suite primitives PapyrOS proved missing. **DONE 2026-07-15 (uncommitted).**

All four landed. Record: [ARCHITECTURE § Shared packages](ARCHITECTURE.md) (`@jkos/ui` +
`@jkos/weave` rows); tests chained (`check:async-view`, the `test:cards` additions,
`test/responsive.mjs` §7 parity). In one breath: **20.1** `<AppShell>` (guard→header→
`SettingsDrawer`→prefs composed via two injected selector hooks so `@jkos/ui` never imports
`@jkos/auth-client`; papyros adopted it and GAINED its missing settings drawer;
BB/ORDECK/jkAuth migration deferred — their headers are genuinely bespoke); **20.2**
`<CoverArt>`/`<MediaGrid density>` with the grid-density ladder moved to
`packages/design/responsive/mediaGrid.ts` (papyros adopted, zero visual change); **20.3**
`<AsyncView>` (loading→error→empty→children; papyros's three hand-rolls migrated, copy deltas
recorded in its test); **20.4** `<MatchPanel>` presentational shell + `connectorPair(appId,
read, capability)` in `@jkos/weave` for cross-app consumers — papyros's own binding deliberately
stays on its direct `api.ts` calls (throw-on-non-2xx distinguishes "search failed" from
"no results"; `weaveClient.list`'s silent-`[]` would erase that).


**Tier 3 — noted, low value, don't build speculatively:** a shared `useHashRoute` (two hand-rolled
routers doesn't justify it); promote `public/sw.js` into the `pnpm new-app` template (it's already
deploy-shape-agnostic) once the music app shows what it actually shares.

### Wave 21 — design-page completeness + the slider primitive. **DONE 2026-07-16.**

`/design` now renders **every** shared class (`pnpm check:design` proves it — see below), plus the
two things it was missing: a live **player bar** (the page inlines `player-ui.css` alongside
hub.css) and a **`.jk-slider`** primitive / `<Slider>` component, which the player `<Scrubber>` and
KourOS's volume + crossfade knobs now all ride instead of three bespoke ranges. Record:
[DESIGN.md](DESIGN.md) (controls + structural-primitives tables). New gate `check:design`
(`test/design-page.mjs`) fails on **stale** (the page is a built snapshot — rerun
`node apps/jkauth/scripts/build-design-page.mjs`) and on **incomplete** (a hub.css class nobody
demos), which is what let the shell/match/async/scrim/cards/player surfaces go unrendered for weeks.

**Open follow-ups this exposed** (found by rendering the system, deliberately *not* fixed in-wave):

- **`.muted` is a legacy alias.** `<MatchPanel>` hardcodes `muted` on its message/meta lines, but
  the rule lived only in `apps/papyros/src/app.css` + `apps/kouros/src/app.css` — a shared
  component that rendered right only in the apps shipping their own copy (the exact trap
  `.jk-cards-*` exists to close). hub.css now owns it byte-identically, so nothing moved. **To
  retire:** point MatchPanel's four `muted jk-match-msg` paragraphs at `.jk-async-note` (identical
  declaration, and they *are* the async triad), delete the two app copies, drop `.muted`.
- **`.jk-match-candidate-meta` inherits `.muted`'s `padding: 1.5rem 0`** — ~24px of dead vertical
  space between a candidate's title and its description, visible on `/design` §13. Almost certainly
  unintended: the author cancelled the same padding one rule away (`.jk-match-msg { padding: 0 }`)
  and missed the meta line. One-line fix, but it changes live PapyrOS spacing — Jag's call.
- **`.jk-sub` on dense small text** blooms into a solid slab in dark mode: its 8px 40%-alpha
  text-shadow compounds across glyphs. It's for short flat secondary text/links; a metadata line
  wants `--color-muted`. Worth a note in the DESIGN.md fence if it bites again.

**Fixed in-wave:** `.jk-media-cover-placeholder` declared `align-items`/`justify-content: center`
but never `display: flex`, and `.jk-media-cover`'s `display: block` won at equal specificity — so
every fallback cover glyph in the suite (PapyrOS's real library grid included) sat in the tile's
top-left corner. Two declarations that had never once done anything.

### Program unblockers (Jag — decisions, not code)

| Decision | Blocks | Default if unspecified |
|---|---|---|
| **`MUSIC_DIR` mount** (env value + compose volume bind, both compose files) | KourOS seeing real music | none — a NAS path is deliberately never hardcoded (mind the nested-`Luna` SMB trap, §2 crib) |
| DNS `papyros.jkos.net` / `kouros.jkos.net` | prod promotes only | staging path-based works without |
| Audnexus as a second metadata provider | §2 6.5e | yes, keyless, as another connector spec |
| Book-club fields beyond name/description/current-pick/members | §2 8.1 | ship the four |

---

## 4. Decisions parked for Jag (deferred by design, with rationale)

Each was consciously stopped, not forgotten — pick any up by choice, none is blocking.

- **BB items onto `defineCollection` (ARCH-1 step 2).** Schema is single-sourced in
  `src/item-fields.js`; full adoption was stopped because items carry lazy seed, recursive
  cascade delete, parent cycle checks, and three calendar sources the collection factory can't
  host as hooks without contortion.
- **Generate hub.css's dark block from `buildTheme` (ARCH-6 step 2).** `tokens-parity`
  structurally closes the paper/dark drift surface; generation would add byte-identical-output
  risk (visual regressions) for low marginal benefit.
- **Prod edge gate for the portal (ARCH-7.4 extension).** The ORDECK SPA self-gates (AuthGuard
  → Google SSO) like every prod origin. A staging-style `auth_request` at the prod edge would
  diverge from that pattern — do it deliberately or not at all.
- **iCloud `ical.js` swap (ARCH-3 seam).** The hand-rolled parser ignores TZID and doesn't
  expand RRULE — both documented in `src/calendar/icloud.js` and PINNED by
  `calendar.sandbox.mjs`. A real `ical.js` provider drops in behind the same `CalendarProvider`
  contract; it's a new dependency, so Jag's call.
- **Design-primitive proposals P1–P9** from the 2026-07-01 visual-unification audit — awaiting
  review.
- **VaultOS** — parked entirely; ZFS covers the need. [VAULTOS.md](VAULTOS.md).

---

## 5. Smaller open items

- **ORDECK calendar-widget live verification.** `bb-week` renders read+light on the HUD;
  code-complete + gated. Remaining: on a running stack, add from the shelf, confirm real BB
  items render, grid drag doesn't clash with the view's internal layout, select is a clean
  no-op. Then note it in ARCHITECTURE.md and delete this line.
- **jkAuth smoke flake.** One 429-timing lockout assertion in `smoke.mjs` can blip in a full
  chain (passes in isolation). Make the budget/wait deterministic (inject the rate-limit window
  or reset the limiter between suites).
- **BeigeBoard mobile drill-down + bench.** The desktop Workshop is the breakdown surface;
  `MobileTasksView` reads the same trees but lacks drill-in/breadcrumb + a compact bench rail
  ([PLANNING_METHOD.md](PLANNING_METHOD.md) § Follow-up).
- **Toolchain alignment.** `apps/sylibos` is React 19 + Tailwind v4 vs the suite's React 18 +
  plain CSS. Deferred until SylibOS re-enters scope (off-limits until then).

---

## 6. After deploy (operational follow-through)

1. `pnpm prove --live https://staging.jkos.net` (+ `--token`) — health, docshape, directory,
   admin gate.
2. `node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>` — the write path
   through the real edge.
3. Set `BREAK_GLASS_TOKEN` in the controller's TrueNAS-side env (`openssl rand -hex 32`) and
   confirm `bash jkos-deploy/scripts/selftest.sh` passes on the host.
4. Confirm `CALENDAR_ENC_KEY` is set in the real BB `.env` (both prod + staging) before anyone
   connects a calendar — adding it later is safe, but earlier rows stay plaintext.
