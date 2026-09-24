# jkOS

**ORDECK is the one-screen portal into your entire digital life, owned entirely by you.**

jkOS is a self-hosted productivity suite running on TrueNAS SCALE. **Seven systems** make up
the suite:

| System | What it is |
|--------|-----------|
| **ORDECK** | The portal — a live HUD of widgets pulling data from every app |
| **jkAuth** | Identity, SSO, and the app directory that drives discovery |
| **BeigeBoard** | Tasks, goals, calendars — the primary data app surfaced on the HUD |
| **Weave** | The integration fabric connecting all apps, read and write |
| **jkDeploy** | The deploy controller — staging→production in one button |
| **LazurOS** | AI gateway — an async job queue routing inference to a tier of compute nodes; powers BeigeBoard's task-parse / goal-breakdown. Registered in the app directory; not yet routed on any deployed edge |
| **KourOS** | Multi-user music AND audiobook library — own scanners and catalogs, one `@jkos/player` for both (gapless/crossfade for music; chapters, speed, sleep, bookmarks, offline and per-user resume for books), playlists, ratings, and one listening session across all your devices. On staging at `/kouros/` |

Everything goes through jkAuth SSO. The portal is driven by Weave discovery — adding a
new app means one registry row, not portal code changes.

One thing in the repo deliberately sits outside that contract: **`music/`**, a
standalone Python vector-search project with zero jkOS imports and no pnpm workspace
membership — see its own [README](../music/README.md).

---

## Using jkOS

### The portal

| | URL |
|-|-----|
| Portal (production) | `https://jkos.net` |
| Staging portal (admin only) | `https://staging.jkos.net` |
| Sign-in / account | `https://auth.jkos.net` |

The portal is the HUD: a grid of widgets showing live data from BeigeBoard (tasks, goals,
calendar events), the system clock, AI status, and more.

| Action | How |
|--------|-----|
| **Launch an app** | Top strip → app switcher. The list is the jkAuth registry — new apps appear automatically. |
| **Rearrange / resize widgets** | Enter **edit mode**, drag to move, drag corner to resize. |
| **Move on touch** | **Hold** a widget (long-press) to pick it up, then drag. A quick tap selects; only real movement drags. |
| **Add a widget** | In edit mode, open the **shelf** and drop a widget onto the grid. |
| **Remove a widget** | In edit mode, remove it — it returns to the shelf, never deleted. |
| **Edit a widget's config** | The **pencil** on a card opens the Widget Workshop for that card. |

Layout is saved per user in jkAuth preferences — your HUD follows you across devices.

### Tasks, goals & calendars (BeigeBoard)

| Action | How |
|--------|-----|
| **Quick-add a task** | Use the **Quick Add** or **Add Task** widget directly on the HUD. |
| **Pin a task to the HUD** | In BeigeBoard → task detail → **pin**. Mirrors to the **Pinned** widget. |
| **Focus on one task** | In BeigeBoard → task detail → **focus**. The **Focus** widget shows it; **END FOCUS** clears it. |
| **Connect a calendar** | BeigeBoard → connect **Google**, **Outlook**, or **iCloud**. Events appear on the HUD calendar. |
| **Import tasks / goals via JSON** | `POST /api/import` on BeigeBoard (also reachable at `/api/beigeboard/import` from any other origin, via the Weave peer proxy). Add `?dryRun=1` to validate without writing. Body: `{ "items": [ … ] }` — nested or flat, with inferred `kind`, forgiving date formats, and validate-then-write semantics. |
| **AI task breakdown** | If LazurOS is enabled, BeigeBoard can parse free-text into tasks and break goals into milestones. |

### Audiobooks (in KourOS)

KourOS's **Books** tab (on a phone: Library → **Audiobooks**) — `staging.jkos.net/kouros/#/books`
on staging; prod pending DNS. The library is scanned from a TrueNAS folder — one subfolder per book — with
metadata read from embedded tags and enriched from the iTunes Search API.

| Action | How |
|--------|-----|
| **Browse & play** | Cover grid → open a book → **Play**. The same player as the music streams a book's files as one timeline; Now Playing shows chapters, ±30 s, speed, sleep timer and bookmarks. |
| **Resume anywhere** | Progress saves per user (debounced) — pick up on any device where you're signed in. |
| **Fix metadata** | Book detail → **Fix metadata** → search → pick a candidate. Admins can also **Rescan** the library and batch-**Match metadata**. |
| **Listen offline** | Book detail → make **available offline** (caches audio + cover); the service worker serves it when the network is down. |
| **Download** | Book detail → download (single file direct, multi-file zipped). |

### Music (KourOS)

Reachable at `staging.jkos.net/kouros/` (staging; prod pending DNS). The library is scanned
per-file (not per-folder) from a TrueNAS music path.

| Action | How |
|--------|-----|
| **Browse & play** | Library grid (artist/album/track views) → **Play**. Gapless playback with a short crossfade between tracks. |
| **Queue** | Shuffle, repeat, reorder by drag; volume and now-playing art-derived accent color. |
| **Playlists** | Create, reorder via drag, rate tracks. |

### Account & sign-in

| Action | How |
|--------|-----|
| **Register** | `auth.jkos.net` → register. The first real account becomes admin. |
| **Log in** | Standard login. **Remember me** keeps you signed in for 30 days. |
| **Guest access** | Read-only across the suite when guest sign-in is enabled. |
| **Two-factor auth** | Account settings → enable **TOTP** and/or **email codes**, save **recovery codes**. |
| **Theme & accent** | Change once in your profile — applies to every app, persists across devices. |
| **Log out** | Revokes every device on that login (the whole session family). |

### Admin actions

| Action | Where |
|--------|-------|
| **Build and publish a widget** | ORDECK **Widget Workshop** (`/widgets`, admin-only). Compose a card from primitives + data sources with live preview, then **Publish** — it lands on every HUD's shelf, no redeploy. |
| **Add an action widget** | In the Workshop, toggle **ACTION**: pick a suite app → pick a capability → map fields (form inputs, fixed values, live clock slice, etc.). |
| **Deploy / promote** | `staging.jkos.net/deploy/` — **Deploy staging** or **Promote to Production** (ships the exact commit just tested on staging). |

---

## The docs

Documentation is a map, not the territory — where a doc and the code disagree, the code wins.

| File | Read it for |
|------|-------------|
| [TODO.md](TODO.md) | **Everything still open, in one place** — what only you can do first, then the decisions you owe, then the engineering backlog. Close an item by deleting it. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the systems fit together — shape, runtime topology, the Weave fabric, each app, the data layer, the gate. |
| [OPERATIONS.md](OPERATIONS.md) | Running and deploying it — dev commands, Docker, the deploy controller, nginx, cold start from zero, TrueNAS paths, secrets, the KourOS Android build. |
| [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) | Bringing LazurOS up on real hardware, phase by phase. ⚠️ **Read before any LazurOS deploy** — it isn't in the staging stack and two bind mounts fail silently if you skip the pre-flight. |
| [The design handoff](https://claude.ai/code/artifact/5e53f12f-cf7d-4e22-b066-4087b47a3e80) | **Published, not in the repo.** The design system and 17 hero shots of the running suite. The 2× originals are generated into `Documentation/Images/`, which is gitignored (they're screenshots of your own data). |

### For agents — `agents/`

Engineering references, written for whoever is changing the code. Agents also get
[`CLAUDE.md`](../CLAUDE.md) at the repo root automatically: the standing rules.

| File | What it holds |
|------|---------------|
| [agents/TRAPS.md](agents/TRAPS.md) | 106 durable traps — browser engines and WebGL, Node/pnpm, SQLite, numpy, Docker, this repo's shape. |
| [agents/TESTING.md](agents/TESTING.md) | Every command, gate and test suite, what each asserts, and how to add one. |
| [agents/WEAVE.md](agents/WEAVE.md) | The integration contract — what an app must implement, the rulings, the checklist for a new app. |
| [agents/DESIGN.md](agents/DESIGN.md) | The design system — tokens, the accent chain, class catalog, per-app constraints. |
| [agents/ALGORITHMS.md](agents/ALGORITHMS.md) | The music vector space and LazurOS design record — measurements, gates, traps. |
| [agents/ROUTINES.md](agents/ROUTINES.md) | BeigeBoard's routine primitive — the document, progression, cadence, the AI-authoring contract. |
| [agents/ROUTINE_PROMPT.md](agents/ROUTINE_PROMPT.md) | **Generated** — the routine-authoring prompt to hand any assistant. Regenerate with `apps/beigeboard/backend/scripts/print-prompt.mjs`; never edit by hand. |
