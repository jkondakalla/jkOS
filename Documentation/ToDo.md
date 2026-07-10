# jkOS — ToDo

The working backlog, rewritten 2026-07-07 after the upgrade program (7 waves: 8 bugs,
8 architecture chunks, 16 testers) completed and the gate went green. 2026-07-08: §2 added —
the PapyrOS + VaultOS new-app program, decomposed into sub-agent-sized waves. Each section is
self-contained — a future agent should be able to execute it without re-deriving context.
When a section is done, fold a one-line note into the relevant `Documentation/*.md` and
delete it here.

---

## ⚠️ Hard constraints a cold agent MUST know

- **Do NOT edit `apps/sylibos/`**, `services/plex-api/`, or `services/recipe-api/` — even
  in suite-wide sweeps. `bb`→`beigeboard` canonicalization never touches `sylib` spellings.
- **Suite scope** = BeigeBoard · jkAuth · jkDeploy · ORDECK · Weave · LazurOS — plus the §2
  new apps (PapyrOS now; VaultOS only once Jag names it).
- **The gate must stay green after every chunk:** `pnpm test:contracts`. The full
  command/gotcha catalog is [PRIMITIVES.md](PRIMITIVES.md) (pnpm-copy staleness, ORDECK
  build+preview not dev, nginx restart-not-reload, root Docker context, quoted repo path).
- `Documentation/` is the source of truth; when a doc disagrees with code, the code wins —
  update the doc.

---

## 0. Commit the batch — DONE 2026-07-08

The batch landed as thematic commits on `staging` (…, `002437f` lazuros, `bf9b54a` AppId/
lego-kit, `8399cc7`/`ef46525`/`4bab15f`/`05afe60` ORDECK HUD, `2156a19` 7-wave audit + docs)
and is pushed to origin. **Remaining follow-through (Jag/ops):** deploy via `/deploy`, then
`pnpm prove --live https://staging.jkos.net` + the live roundtrip with a token — see §5.

---

## 1. LazurOS go-live (phases 5 / 7 / 8)

Phases 0–6 are built, tested (71 backend assertions in the gate + 19 worker assertions in
the standalone `worker.smoke.py` — NOT gate-chained, run it manually), and
code-complete; nothing is mid-edit. What's left is **live bring-up, then two code phases**.
Architecture: [ARCHITECTURE.md § LazurOS](ARCHITECTURE.md). *(The old repo-root LAZUROS.md
spec no longer exists — the architecture section + this list are the plan now.)*

**LazurOS-specific constraints:** no hardware facts in code (model tags, IPs, MACs,
quantizations live in mounted `deployment.json`, never literals); every swappable piece is
a `createXProvider(config)` factory; prompts/model tags load from node-local
`prompts.json`/`models.json`, never inline strings.

**Unblockers needing Jag (content/hardware, not code):**

| Item | Blocks | Notes |
|------|--------|-------|
| **`prompts.json` content** | live e2e of everything | **Top unblocker.** Router triage + per-capability templates; write-back needs the model to emit import-shaped JSON. |
| Luna Ollama Vulkan confirm | Tier 0 | `ollama ps` must show GPU (RX 560 = Vulkan, not ROCm). |
| Whisper + Piper servers | Tier 0 STT/TTS | Stand up the `baseUrl` endpoints in `deployment.jag.json` (`:8000`/`:5000`); source the GLaDOS Piper voice. |
| DDGS sidecar (or SearXNG) | Tier 1 | Provider ships both; jag config points at a ddgs sidecar (`:8001`). |
| Emily static IP + MAC | Phase 5 | Fill `TODO_EMILY_*` in `deployment.jag.json`; DHCP reservation + WoL in BIOS; idle-shutdown on Emily's OS. |
| jkAuth env enrollment | delegation live | Set `JKOS_SERVICE_CLIENTS=lazuros:<secret>:beigeboard:write` + `JKOS_DELEGATION_CLIENTS=lazuros` in the real `.env` (documented in `apps/jkauth/.env.example`). |
| `sudo usermod -aG docker jag` on Emily | local image builds | Until then lazuros builds only on TrueNAS via jkos-deploy. |

**Then, in order:**

- **Phase 5 — Tier 2 wiring.** No code: fill Emily's MAC/IP, verify wake→probe→claim→
  round-trip through the existing `createWolBackend`.
- **Phase 7 — BeigeBoard `/api/ai/*` cutover.** Remove `parse-task`/`breakdown` from the
  BB backend (`src/routes/ai.js`), point FE callers at `runCommand('lazuros', …)`, drop
  `LAZUROS_TOKEN`/`LAZUROS_URL` from BB env. **Must NOT land until LazurOS is serving in
  prod** — otherwise BB loses AI parse with no replacement. After it lands, add the
  cutover gate checks: BB `CAPABILITIES` no longer contains `parse-task`/`breakdown-goal`;
  `LAZUROS_TOKEN` absent from BB `.env.example`; `deployment.example.json` validates
  against `validateDeploymentConfig`.
- **Phase 8 — ORDECK widgets.** Publish WidgetSpec docs through the Workshop for `query`
  (assistant box) + a job-status list. No ORDECK code changes. *(Heads-up from the
  2026-07-09 audit: the `jobs` dataset currently declares only `job_id`/`status`/`user_id`
  filters — no `since` delta cursor yet; the widget polls fine without it, but don't
  assume delta reads exist.)*

---

## 2. Program: PapyrOS + VaultOS — new-app wave backlog

Two plans approved 2026-07-08. **PapyrOS** (`papyros`, port 3010): fully-native multi-user
audiobook app — own scanner/catalog/streaming, per-user progress gated by jkAuth; the iTunes
metadata connector is the ONLY sanctioned external call (no Audiobookshelf). **VaultOS**
(`vault`, port 3011 — *working name, id NOT final*): TrueNAS file browser with per-share ACLs
and hard path containment; explicitly "not soon" — build when Jag says go. This section is
self-contained; the source plans live at `~/.claude/plans/we-will-be-creating-abstract-thompson.md`
(PapyrOS) and `~/.claude/plans/before-creating-papyros-i-m-enumerated-kettle.md` (VaultOS),
but nothing below requires them.

**Execution rules**

- **Start gate:** §0 (commit the batch) lands first — don't scaffold on top of the uncommitted
  tree. VaultOS waves (9–14) are additionally blocked on the **name decision** (the id is baked
  into scope/edge/bus-key and is painful to rename later).
- Waves run in order within an app; the two apps are independent of each other. Tasks marked ∥
  can run in parallel within their wave. The gate (`pnpm test:contracts`) must be green after
  every wave; each app must also `pnpm --filter @jkos/<id> build` clean.
- Every task is sized for one sub-agent pass — **sonnet by default; `[opus]` where flagged**
  (position math, offline sync, security containment).
- Category tags: `[ARCH]` architecture/suite-wiring · `[BUG]` known-bug mitigation ·
  `[FEAT-P]` PapyrOS feature · `[FEAT-V]` VaultOS/storage feature.
  Category index: `[ARCH]` = W1, 3.4, W6, W9, W13, W15 · `[BUG]` = 5.1, 12.1 ·
  `[FEAT-P]` = W2–W5, W7–W8 · `[FEAT-V]` = W10–W12 (+W14 parked).
- **Do NOT pre-abstract the shared streaming/containment code.** Both apps hand-roll HTTP
  Range streaming and path handling first; the `@jkos/files` extraction is deliberately
  Wave 15, only after the second consumer proves the seam.

**Shared crib — cold-start facts every task agent needs**

- Scaffolder: `pnpm new-app <id> --name "<Name>" --port <port>` (`scripts/new-app.mjs`) emits
  `apps/<id>/**`, patches `packages/suite-manifest/apps.js` + `apps.d.ts` (AppId union — the
  gate has a parity check), adds the root **prod** `docker-compose.yml` include, and regenerates
  the four nginx confs (`infra/nginx/gen-nginx-weave.mjs`). It does **not** patch the root
  `docker-compose.staging.yml` (manual) and it defaults `datasets:true`.
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
- Library: `/mnt/Luna/Luna/Plex/Audiobooks` on the TrueNAS host — NOT `/mnt/Luna/Plex/...`. The
  "Luna" SMB share Jag's desktop mounts is itself a dataset nested one level inside the "Luna"
  pool, so the pool-root-looking path is a trap: it silently bind-mounts an empty dir instead of
  erroring (caught 2026-07-09 on papyros's first staging deploy). ~19 titles, one folder per
  book, no author folders — author/series come from embedded tags or the match step. TrueNAS
  files are uid/gid
  `1000:1000`. Data dirs: `/mnt/Luna/Backends/{Production,Staging}/<id>-data` (created on
  first deploy). nginx on deploy: **restart, not reload** (bind-mount inodes).

### PapyrOS

**Waves 1–5 — DONE 2026-07-08/09.** Scaffold+suite wiring, library scanner/catalog, playback
backend (Range/206 streaming, download/zip), iTunes metadata connector (`META`
`defineConnector` + `matchBook`/`matchAllMissing`), frontend SPA+PWA (library browser, player
bar with global multi-file position math, PWA app-shell caching). Committed, gate-green,
documented in [ARCHITECTURE.md § PapyrOS](ARCHITECTURE.md#papyros-the-audiobook-app). Full
task-level detail below is kept for the record; nothing here is open.

<details>
<summary>Wave 1–5 task detail (completed, collapsed)</summary>

**Wave 1 — scaffold + suite wiring `[ARCH]`** *(sequential)*

- [x] **1.1** Run `pnpm new-app papyros --name "PapyrOS" --port 3010` then `pnpm install`.
      Verify the emitted `APPS` row (keep `datasets:true` — papyros serves a `books` dataset),
      the `apps.d.ts` AppId entry, the prod compose include, and the four regenerated nginx
      confs.
- [x] **1.2** Wire mounts + ffmpeg: in `apps/papyros/docker-compose.yml` **and**
      `docker-compose.staging.yml` add volumes
      `${PAPYROS_DATA_PATH:-/mnt/Luna/Backends/<env>/papyros-data}:/data` +
      `/mnt/Luna/Luna/Plex/Audiobooks:/audiobooks:ro` and env `AUDIOBOOKS_DIR: /audiobooks`; add
      `- path: apps/papyros/docker-compose.staging.yml` to the **root**
      `docker-compose.staging.yml`; `apt-get install -y ffmpeg` in the Dockerfile runtime
      (`node:20-slim`) stage.
- [x] **1.3** `cp apps/papyros/.env.example apps/papyros/.env`; add the `BACKEND_DOCS` row in
      `packages/suite-prober/src/sources.mjs`; run the gate + build. (DNS `papyros.jkos.net`
      is Jag's, blocks prod promote only — staging is path-based.)

**Wave 2 — library service: scanner + catalog**

- [x] **2.1 `[FEAT-P]`** Migration replacing the scaffolded `items` collection: a **shared**
      (not user-scoped) `books` table — `id, path UNIQUE, title, subtitle, author, narrator,
      series, series_seq, year, genres(json), duration, files(json:[{index,path,duration,
      codec}]), chapters(json:[{start,end,title}]), cover_path, metadata_source
      ('embedded'|'itunes'|'manual'), ext_ref, mtime, added_at, updated_at`.
- [x] **2.2 `[FEAT-P]`** ∥ `backend/src/library/probe.js`: pure ffprobe wrapper —
      `ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters <file>` →
      `{tags, duration, chapters, codec}`, plus the tag→column mapping
      (`title/artist/album_artist/composer/album/date/genre` → title/author/narrator/series/
      year). Keep the mapping pure and unit-test it against fixture JSON (no exec needed).
- [x] **2.3 `[FEAT-P]`** `backend/src/library/scan.js`: walk `AUDIOBOOKS_DIR` (folder = one
      book); collect audio files ordered by track# then filename; aggregate total duration +
      per-file sequential offsets; cover = embedded
      (`ffmpeg -i <f> -an -c:v copy /data/covers/<id>.jpg`) else a folder `cover.*`; upsert
      rows (skip when folder `mtime` unchanged), delete rows whose folder vanished;
      **non-blocking** background scan on boot; `rescanLibrary` admin-scoped capability.
      Design for N books, not 19.
- [x] **2.4 `[FEAT-P]`** ∥ Hand-authored `books` `DatasetDef` + filtered `GET /api/books`
      reusing `buildItemFilters`/`filterSpec` (title/author prefix, series eq), exposed via
      `serveDatasets` so ORDECK/peers can discover the library.
- [x] **2.5 `[FEAT-P]`** Smoke v1 (new-tester, chained into the gate): commit a tiny fixture
      library (2 books × 2-second files — generate with an ffmpeg sine source + an
      `;FFMETADATA1` `[CHAPTER]` metadata file so one book has embedded chapters); boot the
      real server; assert `/health`, `/api/capabilities` + `/api/datasets` shapes, and that
      the scanner produced a row with duration + chapters. Requires `ffprobe` on PATH locally —
      install and note in TESTING.md if absent.

**Wave 3 — playback backend**

- [x] **3.1 `[FEAT-P]`** `discovery.js` scoped collections (`defineCollection`, `scoped:true`,
      owner = `req.user.sub`): `progress {book_ref, position, duration, finished(filter:eq),
      last_played}`; `bookmarks {book_ref, position, title, note}`; `clubs {name, description,
      current_pick}`; `club_members {club_ref, member_sub}`. Mount with `.mount(app, db)`.
      *Heads-up for Wave 8, don't solve now:* scoped collections hide rows cross-user, so
      "who's-caught-up" will need a bespoke membership-gated read route.
- [x] **3.2 `[FEAT-P]`** ∥ `backend/src/media.js` part 1: `GET /api/stream/:bookId/:fileIndex`
      — resolve catalog → file under `/audiobooks`; honor `Range` → `206` +
      `Content-Range`/`Accept-Ranges`/`Content-Length` via `fs.createReadStream({start,end})`,
      no Range → `200` full. Also `GET /api/cover/:bookId` (cacheable headers) and
      `GET /api/book/:bookId` (full detail: metadata + files + chapters).
- [x] **3.3 `[FEAT-P]`** ∥ `media.js` part 2: `GET /api/download/:bookId` — single file
      streamed direct with `Content-Disposition`; multi-file book → zip stream (new CJS dep,
      e.g. `archiver`). Feeds the Wave-7 offline cache.
- [x] **3.4 `[ARCH]`** `server.js` audit: canonical middleware order (see crib); media routes
      sit after the identity gate (valid `jkos_token` required) and before the SPA fallback.
- [x] **3.5 `[FEAT-P]`** Smoke v2: owner-scoped `progress` round-trip as two mock users (B
      cannot read A's rows); `Range: bytes=0-1023` → `206` with correct `Content-Range`;
      cover route → `200`.

**Wave 4 — metadata enrichment (the suite's first production connector)**

- [x] **4.1 `[FEAT-P]`** `META` connector in `discovery.js` — copy this spec verbatim:

      ```js
      const META = defineConnector({
        app:'papyros', id:'meta', label:'Audiobook metadata',
        base:'https://itunes.apple.com', auth:{ kind:'none' },   // free, no key
        reads:[{ id:'metadataSearch', label:'Metadata candidates',
          upstream:{ path:'/search', query:{ media:'audiobook', entity:'audiobook', limit:'5' } },
          collection:'results',
          map:{ id:'collectionId', title:'collectionName', author:'artistName',
                cover:'artworkUrl100', description:'description', year:'releaseDate',
                genre:'primaryGenreName' },
          item:[ /* typed rows */ ],
          filters:[{ name:'term', type:'string', label:'Search term', column:'term', op:'eq' }] }],
      });
      ```

      `term` passes straight through to the upstream query — no path-param needed, so
      **`packages/weave` stays untouched**.
- [x] **4.2 `[FEAT-P]`** `matchBook` capability + `POST /api/match`: given bookId + a chosen
      candidate, upsize artwork (`100x100` → `600x600` in the URL), download it to
      `/data/covers/<id>.jpg`, write author/series/description + `metadata_source='itunes'` +
      `ext_ref='itunes:<collectionId>'` into the book row.
- [x] **4.3 `[FEAT-P]`** `matchAllMissing` admin capability — conservative: auto-apply only
      exact title+author matches for books still `metadata_source='embedded'` with missing
      author/cover; return everything else as candidate lists for manual review. Manual-first
      is suite philosophy; AI-assist via LazurOS is parked.
- [x] **4.4 `[FEAT-P]`** Smoke v3: mock global `fetch`; assert the connector maps an iTunes
      payload to typed rows, and `matchBook` writes the row + the cover file.

**Wave 5 — frontend SPA + PWA foundation** *(5.2/5.3/5.5 ∥ after 5.1)*

- [x] **5.1 `[FEAT-P]`+`[BUG]`** App shell: `injectJkOSTheme` (parchment/papyrus accent),
      `AuthGuard` redirect login, api client (`authFetch` +
      `weaveClient('papyros').list('books')`); `[BUG]` mirror the vite
      `commonjsOptions.include` fix (`auth-middleware`, `suite-manifest`).
- [x] **5.2 `[FEAT-P]`** Library browser: cover grid, server-driven search/filter (the books
      dataset filters), series grouping, sort; mobile-first via `useBreakpoint` (44px tap
      floor).
- [x] **5.3 `[FEAT-P]`** Item detail: metadata, chapter list, resume, and the "Fix metadata"
      match flow (search term → candidates → pick → `POST /api/match` → refresh).
- [x] **5.4 `[FEAT-P]` `[opus]`** Persistent player bar: `<audio>` on
      `/api/stream/:bookId/:fileIndex`. The hard part is **global position ↔ (fileIndex,
      offset)** across multi-file books — use the `files[].duration` sequential offsets from
      2.3. Chapter prev/next, speed control, scrubber, sleep timer; debounced (~5s) progress
      upsert → per-user resume anywhere; bookmarks add/list/jump.
- [x] **5.5 `[FEAT-P]`** Authenticated download button wired to the 3.3 route.
- [x] **5.6 `[FEAT-P]`** PWA foundation: `public/manifest.webmanifest` + a service worker with
      app-shell caching (installable, **online-first** — media caching is Wave 7). Verify via
      build + preview.

</details>

**Wave 6 — staging bring-up + live verify `[ARCH/ops]`**

- [x] **6.1** Deploy to staging via `/deploy`. `staging-papyros-app` is up + healthy; boot
      scan cataloged 18 titles. The app container was never the problem.
- [x] **6.1a `[BUG]` — THE `/papyros` → ORDECK BUG. Root-caused 2026-07-09; fix is a one-line
      host action, NOT a code change.** The live `standalone-nginx` container was created
      **Jun 25** and its config is a *stale bind-mounted inode*: `docker exec standalone-nginx
      grep papyros /etc/nginx/nginx.conf` returns **nothing**, and `grep apps-generated` returns
      **nothing**. There is no `/papyros` location in the running config at all, so *every*
      `/papyros` request — trailing slash or not — falls through to `location /`, the ORDECK
      portal. `docker inspect` confirms it mounts `weave-proxy*.conf` but **not**
      `apps-generated.conf` / `apps-generated-staging.conf`, which were added to
      `infra/nginx/docker-compose.yml` after the container was created.
      **A bind-mount cannot be added by `docker restart` — only by recreating the container.**
      ⚠️ Worse: a bare `docker restart` now *takes the edge down*. Restart re-resolves
      `standalone.conf` to its new inode, which `include`s `apps-generated*.conf` — files the
      container doesn't mount — so nginx dies with `[emerg] open() failed` and every prod +
      staging site goes with it. **Recreate, don't restart.**
      **Fix (on the TrueNAS host):** `cd /mnt/Luna/Webhost/jkOS-staging/infra/nginx && docker compose up -d`
      — or just run `/deploy`, since `reload_nginx` in `infra/scripts/lib-deploy.sh` now
      self-heals exactly this case (commit `4cba7f8`). Config was validated against the real
      image before recommending: `nginx -t` passes with all five confs mounted (the only
      `[emerg]` in a throwaway container is `host.docker.internal`, which the real container
      resolves via compose `extra_hosts`). **Verify after:** `docker exec standalone-nginx grep
      -c papyros /etc/nginx/nginx.conf` → non-zero, then `curl -I https://staging.jkos.net/papyros/`.
      **FIXED 2026-07-09 (Jag-approved recreate):** `docker compose up -d` recreated the
      container with all five confs mounted; assembled config (`nginx -T`) has 18 papyros
      refs — note `/etc/nginx/nginx.conf` alone shows 0 because papyros lives in the
      *included* `apps-generated-staging.conf`, so verify via `nginx -T`. Bare `/papyros` →
      301 `/papyros/`; `/papyros/` → 302 jkAuth login (the staging edge gate — correct);
      prod edge unaffected. Remaining live checks need a real login (6.2).
- [x] **6.1a-i `[BUG]`** *(separate, real, already fixed — but it was NOT the cause of the
      above.)* Bare `/<id>` (no trailing slash) matches neither `location /<id>/` nor any other
      prefix, so once the config above is actually loaded, bare `/papyros` would still fall to
      `location /`. Fixed in the **generator** (`gen-nginx-weave.mjs`'s `appStagingLocation` now
      also emits `location = /<id> { return 301 …/<id>/; }`), so every current and future
      `edge:'standard'` app gets it. It also matters for the PWA: vite does NOT rewrite
      `public/` hrefs against `base`, so `index.html`'s relative `manifest.webmanifest` /
      `icon-512.png` only resolve from `/papyros/`.
      *(The same bare-path gap exists for the hand-written `/beigeboard/`, `/sylib/`, `/deploy/`
      blocks in `standalone.conf` — bespoke, not generated, so unfixed. Low priority: those are
      long-bookmarked apps and nobody has hit it.)*
- [x] **6.1b `[FEAT-P]`** Frontend usability gaps closed 2026-07-09: mounted the shared
      `@jkos/ui` `SettingsDrawer` (PapyrOS was the only app without one — no sign-out, no
      account, no light/dark or accent control) behind a header gear; added the admin-only
      **Rescan** button wired to the existing `rescanLibrary` capability (the empty state
      told you to rescan but nothing in the UI could); widened `.app-main` 720→1080px so the
      4-column cover grid isn't ~160px/cover, with `.view-book-detail` holding a 720px
      reading measure; dropped the dead Wave-5.1 `.book-list` placeholder CSS.
- [ ] **6.2** Live checklist — **partially verified 2026-07-09, rest needs Jag's own login:**
      - [x] boot scan catalogs the real titles (18 found, embedded metadata) — confirmed via
            direct DB read on the TrueNAS host.
      - [x] `/health`, `/api/capabilities`, `/api/datasets` shapes correct (direct container hit).
      - [ ] jkAuth login; `curl -H 'Range: bytes=0-1023'` → `206`; two users → independent
            resume; match one thin-metadata book; add a bookmark; download a file; install
            the PWA — **all need a real authenticated session** (staging's edge `auth_request`
            + papyros's own JWT identity gate both require a live jkAuth login; no service
            token substitutes for "two independent users"). Do this manually against
            `staging.jkos.net/papyros/`.
      - [ ] `pnpm prove --live https://staging.jkos.net` — ran 2026-07-09, reports `drift` on
            every app's health/capabilities (302 redirect to login), because staging gates
            the whole edge via `auth_request`, not because anything is broken — same result
            for auth/beigeboard/sylibos/lazuros. Re-run with `--token <admin jwt>` once Jag
            has a session to get a clean signal; unauthenticated is expected-red on staging.
      - [ ] suite-health; then promote (prod blocked on DNS).
- [x] **6.3** Documentation: ARCHITECTURE.md § PapyrOS (surfaces, scanner, connector); fold
      finished waves out of this file.

**Wave 7 — offline media (own milestone)**

- [ ] **7.1 `[FEAT-P]` `[opus]`** Offline book cache: download pipeline into Cache
      API/IndexedDB (per-file entries keyed by book), storage estimate + eviction UI,
      "available offline" badge per book.
- [ ] **7.2 `[FEAT-P]` `[opus]`** Offline write queue for progress/bookmarks; reconcile on
      reconnect via the collections' `?since=` delta cursor, last-write-wins on `updated_at`.
- [ ] **7.3 `[FEAT-P]`** Service-worker media routing: serve cached audio when offline,
      online-first otherwise; regression-check the online player.

**Wave 8 — book club + suite integration**

- [ ] **8.1 `[FEAT-P]`** Club views over `clubs`/`club_members` + `progress`: current pick,
      members, who's-caught-up. Needs the membership-gated read route flagged in 3.1 (scoped
      collections hide other users' rows). Club fields beyond
      name/description/current-pick/members are an open Jag item — ship the four by default.
- [ ] **8.2 `[FEAT-P]`** ORDECK "continue listening" HUD widget as a published WidgetSpec via
      the Workshop, reading `weaveClient('papyros')` books + progress — no ORDECK code
      changes (same pattern as LazurOS Phase 8 in §1).
- [ ] **8.3** Parked polish (record only, build on request): SSE/WebSocket "now listening",
      ffmpeg transcode fallback for non-direct-play files, LazurOS auto-match, speed presets,
      bookmark export.

### VaultOS *(blocked on the name decision; "not soon" — start when Jag says go; substitute the final id for `vault` throughout)*

**Wave 9 — scaffold + wiring `[ARCH]`**

- [ ] **9.1** `pnpm new-app <final-id> --name "<FinalName>" --port 3011` + `pnpm install`;
      set **`datasets:false`** in the emitted `APPS` row (v1 serves no dataset — the
      scaffolder defaults it on); keep `api`/`capabilities`/`health`/`edge:'standard'`;
      verify manifest/compose/nginx patches.
- [ ] **9.2** Compose (both files): data volume;
      `${VAULT_CONFIG_PATH:-…/vault-config}/shares.json:/config/shares.json:ro` + env
      `SHARES_CONFIG: /config/shares.json`; **one bind-mount per share** (`:ro` for read-only
      shares — the mount is the outer guard, `shares.json` the inner); add the root staging
      include (manual, as always).
- [ ] **9.3** Author the initial `shares.json` from Jag's share matrix (open item below);
      `.env` from example; prober `BACKEND_DOCS` row; gate green. (DNS `<id>.jkos.net` = Jag,
      prod-only.)

**Wave 10 — shares config + access core (the security heart)**

- [ ] **10.1 `[FEAT-V]`** `backend/src/shares.js`: load + **boot-validate** `SHARES_CONFIG`
      (every `root` exists on disk, ids unique, access rows well-formed) — fail fast on a bad
      config (LazurOS mounted-`deployment.json` precedent). Schema per share:
      `{ id, label, root, access:[ {role:'admin'|'user', mode:'rw'|'ro'} | {sub:'<jkAuth
      sub>', mode} ] }`.
- [ ] **10.2 `[FEAT-V]` `[opus]`** `backend/src/access.js`: `visibleShares(user)` (role or
      sub appears in `access`); `resolve(user, shareId, relPath, need)` → `{absPath, mode}` or
      throws `FORBIDDEN`/`NOT_FOUND` `authError` (reuse `CODES` from
      `packages/auth-middleware/codes.js`). Mode = highest matching grant (`rw` > `ro`);
      writes require `rw` **and** the `vault:write` scope (`requireScope`); admin =
      `req.user.role === 'admin'` checked inline (no `requireRole` helper exists).
      **Containment:** `path.resolve(share.root, rel)` → `fs.realpath` → assert the result is
      inside `fs.realpath(share.root)` — rejects `..`, absolute inputs, symlink escapes. Keep
      it pure and dependency-light.
- [ ] **10.3 `[FEAT-V]`** Containment unit test (new-tester, chained): `../` escape, absolute
      path, symlink pointing outside the share, `ro` vs `rw` resolution, write denied without
      `rw`, visibility filtered by role + sub.
- [ ] **10.4 `[FEAT-V]`** `discovery.js` `CAPABILITIES` doc: `listDir`, `download`, `upload`,
      `mkdir`, `move`, `delete`, `reloadShares` with `vault:write`/`vault:admin` scopes;
      passes the scaffolder's `checkDocShape` gate.

**Wave 11 — filesystem routes** *(every route calls `access.resolve` first)*

- [ ] **11.1 `[FEAT-V]`** `GET /api/vault/shares` (caller's `visibleShares`) +
      `GET /api/vault/fs/:share/*` — `readdir` + `stat` each entry → `{name, type, size,
      mtime}`, dirs first, hidden files filtered by policy.
- [ ] **11.2 `[FEAT-V]`** ∥ `GET /api/vault/download/:share/*` — Range streaming (`206` +
      `Content-Range`/`Accept-Ranges`/`Content-Length`) + `Content-Disposition`. Same
      primitive as papyros 3.2 — hand-roll it again; extraction is Wave 15.
- [ ] **11.3 `[FEAT-V]`** `PUT/POST /api/vault/upload/:share/*` — `busboy` streamed multipart
      to a temp file then **atomic rename** into place (never buffer whole files); max-size +
      free-space check; requires `rw` + `vault:write`. Default limit 2 GB until Jag specifies.
- [ ] **11.4 `[FEAT-V]`** `POST /api/vault/mkdir`, `POST /api/vault/move` (re-resolve **both**
      source and destination through containment), `DELETE /api/vault/rm`; plus
      `POST /api/vault/reload-shares` (`vault:admin`) to re-read `shares.json` without a
      restart.
- [ ] **11.5 `[FEAT-V]`** Backend smoke (fixture share tree): visible-shares filtering per
      mock user, listing shape, Range → `206`, an upload lands on disk, `..` → `403`.

**Wave 12 — frontend explorer** *(12.2–12.4 ∥ after 12.1)*

- [ ] **12.1 `[FEAT-V]`+`[BUG]`** Shell: theme (vault/steel accent), `AuthGuard`, `authFetch`
      api client, share-picker drive tiles; `[BUG]` vite `commonjsOptions.include` mirror.
- [ ] **12.2 `[FEAT-V]`** Explorer: breadcrumb, list/grid toggle, sort by name/size/date, type
      icons, folder navigation; read-only shares hide write affordances (backend re-checks
      regardless).
- [ ] **12.3 `[FEAT-V]`** Upload dropzone (streamed `PUT` with progress, `rw` only) + download
      buttons.
- [ ] **12.4 `[FEAT-V]`** Ops: new folder, rename, move (drag or dialog), delete-with-confirm.

**Wave 13 — staging bring-up + live verify `[ARCH/ops]`**

- [ ] Deploy staging + nginx **restart**; live: a `user` sees only granted shares while
      `admin` sees all; a no-grant second user sees nothing; download + upload on a `rw`
      share; mkdir/rename/delete; `curl -H 'Range: bytes=0-1023'` → `206`; suite-health;
      promote. Then a Documentation section + fold notes.

**Wave 14 — parked futures (record only — do NOT build now)**

DB-backed grants `defineCollection` + admin UI (`shares.json` stays the mount+default-policy
source); audit-log collection (then flip `datasets:true` and serve a real dataset); per-share
quotas; Weave `files` capability (cross-app file references — the suite's shared *file* layer,
never its data layer); ORDECK recent-files widget; thumbnails/previews, server-side search,
zip-folder download, trash/versioning.

### Wave 15 — `@jkos/files` extraction `[ARCH]` *(only after BOTH apps are live)*

- [ ] **15.1** New `packages/files` (`@jkos/files`, CJS): `rangeStream(res, absPath, opts)` +
      `containPath(root, rel)` extracted from the two proven implementations, with unit
      tests; `pnpm install` after creating (`.pnpm-copy`).
- [ ] **15.2** Refactor papyros `backend/src/media.js` + vault `backend/src/fs-routes.js` onto
      `@jkos/files`; both smokes + the gate stay green. The second consumer proves the seam —
      that's why this waited.

### Wave 16 — media/player factory extraction `[ARCH]` *(trigger: the dedicated MUSIC app, not the papyros/vault program)*

Catalogued 2026-07-09 while making PapyrOS deploy-usable. An audiobook app and a music app
overlap almost completely: both are *a scanned library of tagged audio files, rendered as a
cover grid, played through one persistent `<audio>` with a docked transport bar, resumed
per-user across devices*. Everything below already exists **once**, in PapyrOS, written
generically enough to lift. Per the Wave-15 doctrine (*the second consumer proves the seam*),
**do not extract any of it until the music app is real** — build the music app against copies,
then pull the two implementations together. Listed most-valuable first; the source file is
the spec.

**Tier 1 — the media/player kit (only pays off with the 2nd consumer)**

- [ ] **16.1 `[opus]`** `@jkos/player` — headless playback engine, from
      `apps/papyros/src/player/usePlayerEngine.ts` + `position.ts`. The pure math
      (`buildFileMap`/`locate`/`toGlobal`/`navPoints`/`currentNav`/`clamp`/`fmtClock`) lifts
      verbatim; the engine (one persistent `<audio>` built via lazy-ref so handler identity is
      stable, refs-not-state inside listeners, `reqSeq` guard on racing loads, auto-advance on
      `ended`, rate persisted to localStorage) is the hard-won part. **The one real
      difference:** an audiobook is *one continuous timeline over concatenated files*, a music
      album is *discrete tracks*. Same primitive with `timeline: 'continuous' | 'discrete'` —
      continuous keeps the global-seconds cursor, discrete resets per track and exposes
      `trackIndex`. Everything else (transport, seek, buffering, rate) is shared as-is.
- [ ] **16.2** `PlayerBar` as a **slotted shell + stock controls**, not one component. Today's
      `apps/papyros/src/player/PlayerBar.tsx` hardcodes the audiobook control set (±30 s,
      speed, sleep timer, bookmarks); music wants shuffle/repeat/queue/volume. The *layout* is
      what's reusable — desktop 3-column `meta | transport+scrubber | actions`, mobile compact
      row + a "more" bottom sheet, the `pb-scrim`, and the `document.body` padding coordination
      so the fixed bar never covers content. Ship as `<PlayerBar meta actions …>` plus a
      library of stock controls (`<Transport>`, `<Scrubber>`, `<RateButton>`, `<SleepButton>`),
      same kit-of-parts shape as `@jkos/cards`' `cardSurface` factory.
- [ ] **16.3** `useMediaSession({ metadata, handlers })` — the OS lock-screen/media-key wiring
      (`usePlayerEngine.ts`'s `setMediaSession`/`setMediaPlayback`). Pure guarded boilerplate,
      identical for any player, and easy to get subtly wrong (`MediaMetadata` feature-detect,
      per-action try/catch, `playbackState` sync).
- [ ] **16.4** `useResumeCursor(collection, key)` — the debounced (~5 s) find-or-create progress
      upsert from `usePlayerEngine.ts`: serialize in-flight writes, queue the latest, skip
      unchanged positions, guard a late write for the *outgoing* item, and flush on `pause` /
      `visibilitychange` / `beforeunload`. ~60 lines of genuinely subtle code that any player
      (and "recently played" / scrobbling) needs. Natural home is `@jkos/weave` — it is a
      collection-client concern, not an audio one.
- [ ] **16.5** `defineMediaRoutes({ resolveFile })` — a **fourth backend brick type** next to
      `defineCollection` / `defineConnector` / triggers, from `apps/papyros/backend/src/media.js`:
      range-aware `/stream/:id/:index`, `/cover/:id`, and `/download/:id` (single file direct,
      multi-file zipped on the fly). Sits directly on Wave 15's `@jkos/files` `rangeStream` +
      `containPath` — do **16.5 after 15.1**, they are the same seam at two altitudes.
- [ ] **16.6** `defineLibraryScanner({ dir, extensions, mapTags })` — from
      `backend/src/library/{scan,probe}.js`: walk a mount, `mtime`-skip unchanged rows, ffprobe,
      map tags → columns, upsert + prune, bump the resource-bus key. The *ladder* is generic;
      only `mapTagsToColumns` is app-specific (audiobook: composer→narrator, album→series;
      music: album→album, track number, disc number). Pairs with `defineCollection`.

**Tier 2 — suite-wide primitives PapyrOS proved are missing (worth doing regardless of the music app)**

- [ ] **16.7 `[BUG]`** **Primitive prop types are wrong.** `@jkos/ui`'s `BaseProps extends
      HTMLAttributes<HTMLElement>` (`packages/ui/src/primitives.tsx:20`), so `TButton` cannot
      take `disabled`/`type` and `Sheet` cannot take `href` — even though both accept `as`.
      **2026-07-09 audit: 9 call sites across 6 PapyrOS files** (not the 2 first recorded):
      `views/library/BookCard.tsx:13` (Sheet-as-a, `href`), `views/Library.tsx:111` (Rescan,
      `disabled`/`type`), `views/BookDetail.tsx:97` (TButton-as-a, `href`),
      `views/book-detail/MatchPanel.tsx:97,132` (`disabled`/`type` ×2),
      `components/DownloadButton.tsx:25` (`href`/`download`),
      `views/library/LibraryToolbar.tsx:27,91` (Bubble-as-button, `type` ×2),
      `App.tsx:61` (Press-as-a wordmark, `href`). Only 3 carry an apology comment; the rest
      repeat the workaround silently. Zero instances in BB/ORDECK (their raw buttons are
      bespoke-styled, never attempted primitive reuse); jkAuth/LazurOS have no React FE.
      Fix: make the primitives polymorphic over `as` (`ComponentPropsWithoutRef<E>`), so
      `TButton` gets `ButtonHTMLAttributes` and `TButton as="a"` gets `AnchorHTMLAttributes`.
      Cheap, and it deletes the workaround from every app.
- [ ] **16.8** `<AppShell>` — AuthGuard + header (wordmark, subtitle, settings gear) +
      `SettingsDrawer` + `useJkOSPreferences` wiring. Written **four times** now (ORDECK,
      BeigeBoard, SylibOS, and PapyrOS as of 2026-07-09 — which had shipped with *no* drawer at
      all, i.e. no sign-out and no mode toggle, precisely because it was a hand-copy that
      dropped a step). A shell primitive makes that class of omission impossible.
- [ ] **16.9** `CoverArt` + `MediaGrid` + a **grid-density ladder**. `views/library/CoverArt.tsx`
      (skip the network round-trip when `cover_path` is null, `onError` → initials placeholder)
      and the `lib-grid` `data-density` ladder (mobile/tablet/desktop → 2/3/4 columns) are
      pure media-library idiom that a music app reproduces exactly. The 2/3/4 ladder is
      currently hardcoded in `library.css`; it belongs in the design factory next to
      `useBreakpoint`, as tokens or a `useGridDensity()` hook.
- [ ] **16.10** `<AsyncView state={…} empty={…}>` — the `loading ? … : error ? … : empty ? … :`
      triad is hand-rolled in `Library.tsx`, `BookDetail.tsx` and `MatchPanel.tsx` alone, with
      three different copy conventions. Suite-wide papercut.
- [ ] **16.11** `<MatchPanel>` driven by a **connector + capability pair** rather than
      hardcoding `searchMetadata`/`matchBook`. "Search an external provider → show candidates →
      apply one → refresh the row" is exactly the `defineConnector` + write-capability shape
      that already exists in the lego kit; a music app matching MusicBrainz/iTunes wants the
      identical panel. Ties into the parked Audnexus decision above.

**Tier 3 — noted, low value, don't build speculatively**

- `useHashRoute` (papyros) vs ORDECK's path switch — a third hand-rolled router in the music app
  would justify a tiny shared one; two does not.
- `public/sw.js` (base-relative, online-first, unconditional `/api/` bypass so Range requests
  reach the network untouched) is already deploy-shape-agnostic — promote it to the
  `pnpm new-app` template rather than a package. Revisit after Wave 7 adds media caching, since
  that is the part a music app would actually share.

**Program unblockers (Jag — decisions, not code)**

| Decision | Blocks | Default if unspecified |
|---|---|---|
| VaultOS final name (CofferOS / SiloOS / StacksOS / …) | all of W9–W14 | none — id bakes into scope/edge/bus-key |
| Which TrueNAS datasets become shares + per-role/user `ro`/`rw` policy | 9.2 / 9.3 | none |
| Upload max size / per-share quota for v1 | 11.3 | 2 GB max, no quota |
| DNS `papyros.jkos.net` / `<vault>.jkos.net` | prod promotes only | staging path-based works without |
| Book-club fields beyond name/description/current-pick/members | 8.1 | ship the four |
| Audnexus as a second metadata provider (narrator/series/chapters) | nothing | yes later, as another connector spec |
| Offline sequencing (PWA foundation W5 → offline W7) | nothing | recommended path — proceed |

---

## 3. Decisions parked for Jag (deferred by design, with rationale)

Each was consciously stopped, not forgotten — pick any up by choice, none is blocking.

- **BB items onto `defineCollection` (ARCH-1 step 2).** The schema is single-sourced in
  `src/item-fields.js` now; full adoption was stopped because items carry lazy seed,
  recursive cascade delete, parent cycle checks, and three calendar sources that the
  collection factory can't host as hooks without contortion.
- **Generate hub.css's dark block from `buildTheme` (ARCH-6 step 2).** `tokens-parity`
  structurally closes the paper/dark drift surface; the generation layer would add
  byte-identical-output risk (visual regressions) for low marginal benefit.
- **Prod edge gate for the portal (ARCH-7.4 extension).** The ORDECK SPA self-gates
  (AuthGuard → Google SSO) like every other prod origin. Adding a staging-style
  `auth_request` at the prod edge is a deploy-verified change that would diverge from the
  self-gating pattern — do it deliberately or not at all.
- **iCloud `ical.js` swap (ARCH-3 seam).** The hand-rolled parser ignores TZID and doesn't
  expand RRULE — both documented in `src/calendar/icloud.js`'s header and PINNED by
  `calendar.sandbox.mjs`. A real `ical.js` provider drops in behind the same
  `CalendarProvider` contract; it's a new dependency, so Jag's call.
- **Design-primitive proposals P1–P9** from the 2026-07-01 visual-unification audit —
  still awaiting review.

---

## 4. Smaller open items

- **ORDECK calendar-widget live verification.** `bb-week` (and the shelved `bb-calendar`)
  render kit views read+light on the HUD; code-complete + gated. Remaining: on a running
  stack, add from the shelf, confirm real BB items render, grid drag doesn't clash with
  the views' internal layout, select is a clean no-op. Then note it in ARCHITECTURE.md and
  delete this line.
- **jkAuth smoke flake.** One 429-timing lockout assertion in `smoke.mjs` can blip in a
  full chain (passes in isolation). Make the budget/wait deterministic (inject the
  rate-limit window or reset the limiter between suites).
- **BeigeBoard mobile drill-down + bench.** The desktop Workshop is the breakdown surface;
  `MobileTasksView` reads the same trees but lacks drill-in/breadcrumb + a compact bench
  rail ([PLANNING_METHOD.md](PLANNING_METHOD.md) § Follow-up).
- **Toolchain alignment.** `apps/sylibos` is React 19 + Tailwind v4 vs the suite's
  React 18 + plain CSS. Deferred until SylibOS re-enters scope (off-limits until then).

---

## 5. After deploy (operational follow-through)

Once §0 ships to staging/prod:

1. `pnpm prove --live https://staging.jkos.net` (+ `--token`) — health, docshape,
   directory, admin gate.
2. `node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>` — the write path
   through the real edge.
3. Set `BREAK_GLASS_TOKEN` in the controller's TrueNAS-side env (`openssl rand -hex 32`)
   and confirm `bash jkos-deploy/scripts/selftest.sh` passes on the host.
4. Confirm `CALENDAR_ENC_KEY` is set in the real BB `.env` (both prod + staging) before
   anyone connects a calendar — adding it later is safe, but earlier rows stay plaintext.
