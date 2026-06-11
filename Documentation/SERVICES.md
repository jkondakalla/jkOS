# jkOS — Service Reference

Condensed per-unit reference. Paths are repo-relative. See ARCHITECTURE.md for the
shared-package contract and auth/theme flows.

## Deployable services

| Service | Dir | Package | Container | Port | URL | Role |
|---------|-----|---------|-----------|------|-----|------|
| ORDECK | `apps/ordeck` | `@jkos/ordeck` | `ordeck-shell` | 80 (nginx) | `jkos.net` | hub portal |
| jkAuth | `apps/jkauth` | `@jkos/jkauth` | `jkos-auth` | 3100 | `auth.jkos.net` | hub SSO |
| BeigeBoard | `apps/beigeboard` | `@jkos/beigeboard` (+ `…-backend`) | `bb-app` | 3001 | `beigeboard.jkos.net` | hub app |
| SylibOS | `apps/sylibos` | `@jkos/sylibos` (+ `…-api`) | `sylibos-frontend` / `sylibos-api` | 80 / 8004 | `sylibos.jkos.net` | pluggable app |
| LazurOS | `apps/lazuros` | — (Python) | `lazuros` | 8080 (host net) | internal | hub AI gateway |

### ORDECK — `apps/ordeck`
- Vite SPA (React 18) + `@originjs/vite-plugin-federation`. Served static by nginx.
- Theme/prefs: `src/hooks/useJkOSPreferences.ts` wraps `@jkos/auth-client`'s hook,
  adding CRT scanline var + `ordeck-mode` event via `onApply`.
- AppLauncher fetches `GET /auth/apps`. Widgets in `src/widgets/**`; shell uses `@jkos/ui`.
- Docker: `apps/ordeck/Dockerfile` (root context) → nginx with `apps/ordeck/nginx.conf`.

### jkAuth — `apps/jkauth`
- Express + better-sqlite3 + bcrypt + jsonwebtoken (RS256) + googleapis + express-rate-limit.
- All logic in `server.js`. DB at `DB_PATH` (`/data/jkos-auth.db`), WAL, FK on.
- Migrations run **001_init → 002_user_preferences** (order matters; 002 ALTERs the
  table 001 creates). 002 also self-heals a missing `preferences` column on boot.
- Key routes: `POST /auth/{login,register,logout,refresh,guest}`, `GET /auth/{me,profile,apps,jwks,require-admin,google,google/callback}`, `PATCH /auth/profile`, `GET /health`.
- `require-admin` = nginx `auth_request` target (status-only). `validateRedirectTo`
  allows only `app_registry` origins. No frontend bundle (server-rendered login HTML only).
- Does **not** use `@jkos/auth-middleware` (it is the issuer; verifies inline via `resolveUser`).

### BeigeBoard — `apps/beigeboard`
- Frontend: Vite SPA (React 18). `src/lib/jkauth.ts` re-exports `@jkos/auth-client`;
  `src/lib/theme.ts` holds app-specific helpers (fonts, colors, `halate`, date fmt) — **not** jkOS theme.
- Backend: `backend/server.js` (Express + better-sqlite3 + googleapis). Serves the SPA
  from `STATIC_DIR` (catch-all → `dist/index.html`) and `/api/*`. Auth via
  `@jkos/auth-middleware` (`jkosAuth({publicKey, issuer})`). `req.user.sub` = user id.
- One image (`apps/beigeboard/Dockerfile`): builds SPA, `pnpm deploy` bundles backend.

### SylibOS — `apps/sylibos`
- Frontend: Vite SPA (React 19) + Tailwind v4, Zustand, react-router. Pluggable app.
  - `src/api/auth.ts` re-exports `@jkos/auth-client`; keeps a same-origin `getMe`
    (`/api/auth/me`). `src/lib/theme.ts` keeps SylibOS preset **schemes** + delegates
    jkOS theme to `@jkos/auth-client`'s `applyTheme`.
  - `src/store/authStore.ts` = session init (getMe → refresh → redirect).
- Backend: `backend/index.js` (Express ESM + better-sqlite3 + node-cron). Auth via
  `@jkos/auth-middleware`. Two images (`Dockerfile`, `backend/Dockerfile`), root context.
- **Question stems** (`backend/stems.js` + `expr.js` + `pdftext.js`): parameterized
  questions distilled from each course's actual assignment PDFs (psets/exams in
  library.db asset BLOBs → `unpdf` text extraction → one AI call per assignment →
  validated templates with `{{var}}` slots, ranges, constraints, answer/distractor
  expressions). Variants are instantiated deterministically (seeded RNG + safe
  expression evaluator — no eval, no AI): same seed ⇒ same variants; answers and MCQ
  distractors are computed per variant. Routes: `GET /api/stems/assignments`,
  `POST /api/stems/from-course`, `POST /api/stems/generate` (manual text path),
  `GET /api/stems[/:id][/variants]`, `DELETE /api/stems/:id`. Stems link back to
  `(course_id, lecture_id, asset_id)`; AI output is shape-checked **and** functionally
  proven (sampled + evaluated under multiple seeds) before storage.

#### CourseProcessor — `apps/sylibos/CourseProcessor/`
Python OCW ingest pipeline. Entry point: `library_cli.py` (`inspect` / `build` / `load`
commands writing to `library.db`; `build-dir` / `batch` writing file-based processed
course folders). Core calls: `ingest.ingest_zip()` (zips) and `ingest.ingest_dir()`
(already-extracted modern exports — structured parse with heuristic HTML fallback for
single-page feature courses; no AI rung for directory ingest).

**Processed course folders** (`build-dir <course_dir>` / `batch <courses_root>`,
default `--out ./ProcessedCourses`): per-course `<out>/<slug>/` containing `ir.json` +
`assets/` (same contract as `build`) plus the concept-tree artifacts `course.json`
(identity + counts), `tree.json` (trunk/branch/leaf node graph, uuid5 ids stable
across re-ingest), `concepts.json` (chunked ~15-min trunk content), `exercises.json`
(pset/exam-backed + stub branches), `lessons.json` (notes-text chunks), `videos.json`
(per-video cue-timed segments; skipped with `--no-videos`). Chunking modules:
`chunk.py` (split ladder: discourse > silence gap > proportional; headings for text),
`syllabus.py` (calendar table/paragraph parse + title-similarity join),
`scaffold.py` (bundle orchestrator; Scholar shared-clip videos are apportioned across
their sessions by clip count — `boundary_quality: clip_share`). Served read-only by
`backend/processed.js` under `/api/processed` (path via `$PROCESSED_COURSES_PATH`);
frontend types in `src/lib/treeApi.ts` mirror the JSON 1:1. `Courses/` (originals)
and `ProcessedCourses/` are gitignored — regenerable data, never committed.

**Ingest ladder (in order, first non-empty result wins):**
1. **Structured** — `detect.detect_format` → `ModernAdapter` / `LegacyAdapter` → shape
   builders (`shapes/scholar`, `seminar`, `flat_feature`, `project_lab`) →
   `manifest_to_ir` converts `CourseManifest` → `Course` IR.
2. **Heuristic** — `extract` + `structure` HTML walk for unknown/legacy layouts; legacy
   metadata merged from `LegacyAdapter` when present.
3. **AI split** — only when heuristic confidence < threshold AND `--ai` flag passed;
   model proposes skeleton, deterministic extraction still fills content.

**Key invariants:**
- Modern OCW has two live vintages: **v1** (`video_metadata.youtube_id` +
  `learning_resource_types`), **v2** (`youtube_key` + `resource_type`, empty
  `learning_resource_types`). Both must stay supported in `adapters/modern.py`.
- Session↔resource linking (`linking.py`) is deterministic via session `index.html`
  hrefs → `resources/{slug}/`. Fuzzy matching is suppressed when page-ref coverage
  is good (prevents zh-hans dub mislinks).
- Teaching order comes from rendered nav hrefs (`ordering.py`), not alphabetical slugs.
- `library.db` schema is mirrored in `backend/library.js` (Node read-only runtime) —
  **change both together**.
- Real OCW test fixtures: `/mnt/Luna/Open Courseware/`. Venv: `CourseProcessor/.venv`.

### LazurOS — `apps/lazuros`
- Python (FastAPI/uvicorn). Ollama proxy + Wake-on-LAN. `network_mode: host` (WoL broadcast).
- `auth.py` verifies jkOS JWTs in Python (separate from `@jkos/auth-middleware`).

## Shared packages — `packages/*`
See ARCHITECTURE.md → "Shared package map". All are `private`, source-only, `@jkos/*`.
`@jkos/auth-middleware` ships dual entry: `index.js` (CJS) + `index.mjs` (ESM).

## Not in prod deploy
- `plugins/*` — ORDECK federation microfrontends (`@jkos/*-plugin`); experimental.
- `services/plex-api`, `services/recipe-api` — Python; not in root compose `include`.
