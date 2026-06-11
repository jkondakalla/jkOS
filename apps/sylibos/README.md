# SylibOS

Self-hosted MIT OpenCourseWare study system. Part of the **jkOS monorepo** at `apps/sylibos/`. Live at `sylibos.jkos.net`.

Serves OCW courses from `library.db` (catalog), supports nightly AI quiz generation, streak tracking, and a file-based concept-tree layer (`ProcessedCourses/`) for the node-graph GUI.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 · TypeScript · Vite · Zustand · Tailwind v4 · React Router |
| Backend | Node.js 20 · Express ESM · SQLite (`better-sqlite3`) · node-cron |
| AI (browser + nightly) | LazurOS → Ollama / Anthropic SDK |
| CourseProcessor | Python 3.12 · pdfminer · BeautifulSoup · lxml |
| Docker | `Dockerfile` (frontend SPA) + `backend/Dockerfile` (API); both build from **repo root context** |

Auth is provided by `@jkos/auth-middleware` (backend) and `@jkos/auth-client` (frontend) — no per-app JWT logic.

---

## Development

```bash
# from repo root
pnpm install

# backend (port 8004)
pnpm --filter @jkos/sylibos-api dev

# frontend (port 5173, proxies /api → 8004 via vite config)
pnpm --filter @jkos/sylibos dev
```

CourseProcessor has its own venv:

```bash
cd apps/sylibos/CourseProcessor
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

---

## Importing a course

### Option A — browser upload

Download a course ZIP from [ocw.mit.edu](https://ocw.mit.edu), then **Import → drag ZIP in**.

### Option B — CourseProcessor CLI (zip)

```bash
cd apps/sylibos/CourseProcessor
source .venv/bin/activate

# dry-run report (no writes)
python -m CourseProcessor.library_cli inspect course.zip --course-number 18.01SC

# build IR + assets
python -m CourseProcessor.library_cli build course.zip --out ./build

# load into library.db
python -m CourseProcessor.library_cli load ./build/18-01sc-fall-2010 --db /data/library.db
```

### Option C — batch ingest from extracted directories

For already-extracted modern OCW exports (the `Courses/` folder):

```bash
# process one course (full, with videos)
python -m CourseProcessor.library_cli build-dir "Courses/Single Variable Calculus-2010" \
  --out ProcessedCourses

# process all 16 courses, skip videos (skeleton mode)
python -m CourseProcessor.library_cli batch Courses --out ProcessedCourses --no-videos
```

Output goes to `ProcessedCourses/<slug>/` — `ir.json` + `assets/` + concept-tree artifacts (`course.json`, `tree.json`, `concepts.json`, `exercises.json`, `lessons.json`, `videos.json`). See [SERVICES.md](../../Documentation/SERVICES.md) → CourseProcessor for schema details.

`Courses/` and `ProcessedCourses/` are **gitignored** (multi-GB, regenerable).

---

## Backend API

```
GET  /health
GET  /api/auth/me                         ← same-origin jkAuth proxy
GET/POST   /api/courses
GET/DELETE /api/courses/:id
GET/POST   /api/segments
PATCH      /api/segments/:id
GET/POST   /api/daily-logs
GET/PUT    /api/settings
GET        /api/summary                   ← ORDECK widget feed
POST       /api/import-manifest           ← CourseManifest JSON from CLI build
POST       /api/admin/run-nightly

GET        /api/processed                 ← catalog of processed course folders
GET        /api/processed/:slug           ← course.json
GET        /api/processed/:slug/:artifact ← tree | concepts | exercises | lessons | videos
GET        /api/processed/:slug/asset/*   ← PDF streaming (path-traversal guarded)

GET        /api/stems/assignments         ← pset/exam PDFs in user's courses
POST       /api/stems/from-course         ← AI-distill stems from all assignments in a course
POST       /api/stems/generate            ← AI-distill stems from provided assignment text
GET        /api/stems                     ← all stems for user (filter: ?course_id=)
GET        /api/stems/:id                 ← single stem
GET        /api/stems/:id/variants        ← deterministic variants (seeded RNG, no AI)
DELETE     /api/stems/:id
```

The processed-course routes are served from `$PROCESSED_COURSES_PATH` (default `/data/ProcessedCourses`). Frontend types are in `src/lib/treeApi.ts`.

---

## Production (Docker)

Both images build from the **repo root context** (required for `@jkos/*` workspace packages):

```bash
# from repo root
docker compose up -d --build sylibos-frontend sylibos-api
```

### Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `JKOS_AUTH_PUBLIC_KEY` | yes | RS256 public key from jkAuth — copy from `apps/jkauth/.env` |
| `JKOS_AUTH_ISSUER` | yes | `jkos-auth` (prod) / `jkos-auth-staging` (staging) |
| `AI_PROVIDER` | yes | `lazuros` \| `ollama` \| `claude` \| `none` |
| `LAZUROS_URL` | when `AI_PROVIDER=lazuros` | e.g. `http://host.docker.internal:8080` |
| `LAZUROS_TOKEN` | when `AI_PROVIDER=lazuros` | same token as LazurOS, BeigeBoard |
| `PROCESSED_COURSES_PATH` | no | default `/data/ProcessedCourses` |
| `LIBRARY_DB_PATH` | no | default `/data/library.db` |

See `.env.example` for full documentation.

---

## AI provider configuration

Set in **Settings** page (persisted to backend DB) or via environment variables above:

| Provider | What you need |
|----------|--------------|
| `lazuros` | LazurOS URL + API token — recommended (local Ollama via WoL) |
| `ollama` | Direct Ollama URL (compute node must be awake) |
| `claude` | Anthropic API key |
| `none` | Placeholder quizzes (no LLM) |

---

## Further reading

- [Documentation/SERVICES.md](../../Documentation/SERVICES.md) — CourseProcessor pipeline, ingest ladder, processed-course schema, API routes
- [Documentation/ARCHITECTURE.md](../../Documentation/ARCHITECTURE.md) — monorepo layout, `@jkos/*` package contract, auth flow
- [Documentation/OPERATIONS.md](../../Documentation/OPERATIONS.md) — build commands, Docker model, deploy
