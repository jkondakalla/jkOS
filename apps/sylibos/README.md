# SylibOS

Self-hosted MIT OpenCourseWare study system with AI-generated quizzes, nightly lesson processing, and streak tracking. Part of the [jkHUB](https://github.com/jkondakalla/ORDECK) personal dashboard.

**Live:** `https://sylibos.jkos.net`

---

## What it does

- Import MIT OCW courses from ZIP files (Python preprocessor handles all ZIP layouts)
- AI organises lectures into units, generates 4-question quizzes + 2-minute tasks per lesson
- Nightly cron job processes unhandled lectures automatically
- Track daily study goal, streak, and overall course progress
- Lesson player: PDF viewer + quiz + tasks inline
- All AI routes through LazurOS (local Ollama via Wake-on-LAN) — no cloud required

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 · TypeScript 6 · Vite 8 · Zustand · Tailwind 4 · React Router 7 |
| Backend | Node.js 20 · Express · SQLite (`better-sqlite3`) · node-cron |
| AI (browser) | LazurOS proxy → Ollama / direct Ollama / Anthropic SDK |
| AI (nightly) | LazurOS proxy → Ollama / direct Ollama |
| Preprocessor | Python 3.11 · pdfminer · BeautifulSoup |
| Docker | nginx:alpine (frontend SPA) + node:20-alpine (API) |

---

## Development

```bash
# Backend
cd backend
npm install
node index.js          # port 8004

# Frontend (separate terminal)
npm install
npm run dev            # port 5173, proxies /api → 8004 via vite config
```

Open `http://localhost:5173`, go to **Settings**, set Backend URL to `http://localhost:8004`.

---

## Production (Docker)

```bash
cp .env.example .env
nano .env              # set AI_PROVIDER, LAZUROS_URL, LAZUROS_TOKEN

mkdir -p /mnt/Luna/sylibos-data
docker compose up -d --build
```

The standalone nginx at `ORDECK/docker/standalone-nginx/` proxies `sylibos.jkos.net` to this stack.

---

## Importing a course

**Option A — browser upload**
1. Download a course ZIP from [ocw.mit.edu](https://ocw.mit.edu)
2. Open SylibOS → Import → drag the ZIP in

**Option B — preprocessor CLI**
```bash
cd preprocessor
pip install -r requirements.txt

# Process locally and push to running API
python -m preprocessor path/to/course.zip --push-to http://localhost:8004/api

# Or just produce the manifest JSON
python -m preprocessor path/to/course.zip --output manifest.json
```

---

## AI provider configuration

Set in **Settings** page (persisted to localStorage + backend DB):

| Provider | What you need |
|----------|--------------|
| `lazuros` | LazurOS URL + API token (recommended — local Ollama via WoL) |
| `ollama` | Direct Ollama URL (compute node must be awake) |
| `claude` | Anthropic API key |
| `none` | Placeholder quizzes (no LLM) |

The backend also reads `AI_PROVIDER`, `LAZUROS_URL`, `LAZUROS_TOKEN`, `OLLAMA_URL`, `OLLAMA_MODEL` from the environment as defaults for the nightly job. Any setting saved via the UI overrides them.

---

## Backend API

```
GET  /health
GET/POST   /api/courses
GET/DELETE /api/courses/:id
GET/POST   /api/segments
PATCH      /api/segments/:id
GET/POST   /api/daily-logs
GET/PUT    /api/settings
GET        /api/summary               ← ORDECK widget feed
POST       /api/import-manifest       ← CourseManifest JSON from preprocessor
POST       /api/admin/run-nightly     ← manual trigger
```

---

## Environment variables

See [`.env.example`](.env.example) for full documentation. Required for production:

```
AI_PROVIDER=lazuros
LAZUROS_URL=http://host.docker.internal:8080
LAZUROS_TOKEN=<token>
```

Optional (leave `JWT_SECRET` empty for open LAN access):
```
JWT_SECRET=<hex64>
NIGHTLY_CRON=0 2 * * *
```
