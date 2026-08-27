# jkOS

**ORDECK is the one-screen portal into your entire digital life, owned entirely by you.**

jkOS is a self-hosted productivity suite running on TrueNAS SCALE. **Eight systems** make up
the suite:

| System | What it is |
|--------|-----------|
| **ORDECK** | The portal — a live HUD of widgets pulling data from every app |
| **jkAuth** | Identity, SSO, and the app directory that drives discovery |
| **BeigeBoard** | Tasks, goals, calendars — the primary data app surfaced on the HUD |
| **Weave** | The integration fabric connecting all apps, read and write |
| **jkDeploy** | The deploy controller — staging→production in one button |
| **LazurOS** | AI gateway — an async job queue routing inference to a tier of compute nodes; powers BeigeBoard's task-parse / goal-breakdown. Registered in the app directory; not yet routed on any deployed edge |
| **PapyrOS** | Fully-native multi-user audiobook library — own scanner, catalog, Range-streamed playback, offline caching, per-user resume. On staging at `/papyros/` |
| **KourOS** | Fully-native multi-user music library — the shared `@jkos/player` primitive's second consumer, gapless/crossfade playback, playlists, ratings. On staging at `/kouros/` |

Everything goes through jkAuth SSO. The portal is driven by Weave discovery — adding a
new app means one registry row, not portal code changes.

Two things in the repo deliberately sit outside that contract: **SylibOS**
(`apps/sylibos/`), a separate study app on its own development track, and **`music/`**, a
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

### Audiobooks (PapyrOS)

Reachable at `staging.jkos.net/papyros/` (staging; prod pending DNS). The library is scanned
from a TrueNAS folder — one subfolder per book — with metadata read from embedded tags and
enriched from the iTunes Search API.

| Action | How |
|--------|-----|
| **Browse & play** | Cover grid → open a book → **Play**. One persistent player bar streams across a book's files as a single timeline; speed, sleep timer, chapter skip. |
| **Resume anywhere** | Progress saves per user (debounced) — pick up on any device where you're signed in. |
| **Fix metadata** | Book detail → **Fix metadata** → search → pick a candidate. Admins can also **Rescan** the library and batch-**Match metadata**. |
| **Listen offline** | Book detail → make **available offline** (caches audio + cover); the service worker serves it when the network is down. |
| **Download** | Book detail → download (single file direct, multi-file zipped). |

### Music (KourOS)

Reachable at `staging.jkos.net/kouros/` (staging; prod pending DNS). The library is scanned
per-file (not per-folder) from a TrueNAS music path.

| Action | How |
|--------|-----|
| **Browse & play** | Library grid (artist/album/track views) → **Play**. Gapless playback with a
short crossfade between tracks. |
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

## Reference docs

Documentation here is a map, not the territory — where a doc and the code disagree, the code
wins and the doc is stale. [`RESET.md`](RESET.md) is the current mandate: what's being
rebuilt, why, and in what order. Read it first if you're picking up engineering work.

| File | Read it for |
|------|-------------|
| [RESET.md](RESET.md) | **The current mandate.** What's ceremony vs. still load-bearing, the work ahead stage by stage, and the standing rules of engagement. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the systems fit together — mental models, auth/session model, data ownership, Weave fabric, nginx topology, prod/staging isolation. **Engineering entry point**, alongside WEAVE.md. |
| [PRIMITIVES.md](PRIMITIVES.md) | **The command/gate catalog** — every command, gate, and skill you can run, by category, with how and why. |
| [WEAVE.md](WEAVE.md) | The integration contract in full — what an app must implement, transport model, security model, command vocabulary, adding a new app. |
| [OPERATIONS.md](OPERATIONS.md) | Dev commands, Docker build model, deploy pipeline, cold start from zero, TrueNAS paths, known gotchas. |
| [DESIGN.md](DESIGN.md) | Design system — aesthetic identity, token contract, factory, typography, per-app constraints. |
| [TESTING.md](TESTING.md) | The test system — every test and what it asserts, the gate anatomy, the suite prober, house patterns for new tests. |
| [PLANNING_METHOD.md](PLANNING_METHOD.md) | The breakdown method the BeigeBoard Workshop embodies — taxonomy, weekly bench, data mapping. Informational; ROUTINES.md is authoritative where they touch. |
| [ROUTINES.md](ROUTINES.md) | The routine primitive: the document format, progression, cadence, the library, and the AI-authoring contract. |
| [ALGORITHMS.md](ALGORITHMS.md) | The music vector-space design record — mel spectrograms, embeddings, similarity search, calibration. |
