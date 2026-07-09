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

Phases 0–6 are built, tested (71 backend + 15 worker assertions, all in the gate), and
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
  (assistant box) + a job-status list. No ORDECK code changes.

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
- Library: `/mnt/Luna/Plex/Audiobooks` (~19 titles, one folder per book, no author folders —
  author/series come from embedded tags or the match step). TrueNAS files are uid/gid
  `1000:1000`. Data dirs: `/mnt/Luna/Backends/{Production,Staging}/<id>-data` (created on
  first deploy). nginx on deploy: **restart, not reload** (bind-mount inodes).

### PapyrOS

**Wave 1 — scaffold + suite wiring `[ARCH]`** *(sequential)*

- [x] **1.1** Run `pnpm new-app papyros --name "PapyrOS" --port 3010` then `pnpm install`.
      Verify the emitted `APPS` row (keep `datasets:true` — papyros serves a `books` dataset),
      the `apps.d.ts` AppId entry, the prod compose include, and the four regenerated nginx
      confs.
- [x] **1.2** Wire mounts + ffmpeg: in `apps/papyros/docker-compose.yml` **and**
      `docker-compose.staging.yml` add volumes
      `${PAPYROS_DATA_PATH:-/mnt/Luna/Backends/<env>/papyros-data}:/data` +
      `/mnt/Luna/Plex/Audiobooks:/audiobooks:ro` and env `AUDIOBOOKS_DIR: /audiobooks`; add
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

- [ ] **4.1 `[FEAT-P]`** `META` connector in `discovery.js` — copy this spec verbatim:

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
- [ ] **4.2 `[FEAT-P]`** `matchBook` capability + `POST /api/match`: given bookId + a chosen
      candidate, upsize artwork (`100x100` → `600x600` in the URL), download it to
      `/data/covers/<id>.jpg`, write author/series/description + `metadata_source='itunes'` +
      `ext_ref='itunes:<collectionId>'` into the book row.
- [ ] **4.3 `[FEAT-P]`** `matchAllMissing` admin capability — conservative: auto-apply only
      exact title+author matches for books still `metadata_source='embedded'` with missing
      author/cover; return everything else as candidate lists for manual review. Manual-first
      is suite philosophy; AI-assist via LazurOS is parked.
- [ ] **4.4 `[FEAT-P]`** Smoke v3: mock global `fetch`; assert the connector maps an iTunes
      payload to typed rows, and `matchBook` writes the row + the cover file.

**Wave 5 — frontend SPA + PWA foundation** *(5.2/5.3/5.5 ∥ after 5.1)*

- [ ] **5.1 `[FEAT-P]`+`[BUG]`** App shell: `injectJkOSTheme` (parchment/papyrus accent),
      `AuthGuard` redirect login, api client (`authFetch` +
      `weaveClient('papyros').list('books')`); `[BUG]` mirror the vite
      `commonjsOptions.include` fix (`auth-middleware`, `suite-manifest`).
- [ ] **5.2 `[FEAT-P]`** Library browser: cover grid, server-driven search/filter (the books
      dataset filters), series grouping, sort; mobile-first via `useBreakpoint` (44px tap
      floor).
- [ ] **5.3 `[FEAT-P]`** Item detail: metadata, chapter list, resume, and the "Fix metadata"
      match flow (search term → candidates → pick → `POST /api/match` → refresh).
- [ ] **5.4 `[FEAT-P]` `[opus]`** Persistent player bar: `<audio>` on
      `/api/stream/:bookId/:fileIndex`. The hard part is **global position ↔ (fileIndex,
      offset)** across multi-file books — use the `files[].duration` sequential offsets from
      2.3. Chapter prev/next, speed control, scrubber, sleep timer; debounced (~5s) progress
      upsert → per-user resume anywhere; bookmarks add/list/jump.
- [ ] **5.5 `[FEAT-P]`** Authenticated download button wired to the 3.3 route.
- [ ] **5.6 `[FEAT-P]`** PWA foundation: `public/manifest.webmanifest` + a service worker with
      app-shell caching (installable, **online-first** — media caching is Wave 7). Verify via
      build + preview.

**Wave 6 — staging bring-up + live verify `[ARCH/ops]`**

- [ ] **6.1** Deploy to staging via `/deploy`; **restart** nginx; app at
      `staging.jkos.net/papyros/`.
- [ ] **6.2** Live checklist: boot scan catalogs the ~19 real titles; jkAuth login;
      `curl -H 'Range: bytes=0-1023'` → `206`; two users → independent resume; match one
      thin-metadata book; add a bookmark; download a file; install the PWA;
      `pnpm prove --live https://staging.jkos.net` + suite-health; then promote (prod blocked
      on DNS).
- [ ] **6.3** Documentation: ARCHITECTURE.md § PapyrOS (surfaces, scanner, connector); fold
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
