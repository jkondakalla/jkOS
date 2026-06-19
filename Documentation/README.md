# jkOS

**ORDECK is the one-screen portal into your entire digital life, owned entirely by you.**

jkOS is a self-hosted suite: **ORDECK** (the portal/HUD) · **jkAuth** (identity + the app
directory) · **BeigeBoard** (tasks, goals, calendars) · **SylibOS** (study) · **LazurOS**
(AI gateway), woven together by [Weave](WEAVE.md) so every app is reachable, readable, and
actionable from one screen.

- **Using it day to day?** Read *Using jkOS* below.
- **Running or building it?** Jump to [Developer & operator commands](#developer--operator-commands).
- **An agent working in the repo?** See the [Reference docs](#reference-docs) table.

---

## Using jkOS

Everything below is a **user-facing action** — what you click, type, or hold.

### The portal & HUD

| Where | URL |
|-------|-----|
| Portal (production) | `https://jkos.net` |
| Staging portal (admin) | `https://staging.jkos.net` |
| Sign-in / account | `https://auth.jkos.net` |

The portal is the HUD: a grid of widgets pulling live data from every app.

| Action | How |
|--------|-----|
| **Launch an app** | Top strip → app popover → pick an app (the list is the jkAuth registry, so new apps appear automatically). |
| **Rearrange / resize widgets** | Enter **edit mode**, then drag a widget to move it or drag its corner to resize. |
| **Move on touch / iPhone** | **Hold** a widget (long-press) to pick it up, then drag. A quick tap selects; only a real drag moves it. |
| **Add a widget** | In edit mode, open the **add strip** (the shelf) and drop a shelved widget onto the grid. |
| **Remove a widget** | In edit mode, remove it — it returns to the shelf (it's never deleted, just unplaced). |
| **Edit a widget's design** | The **pencil** affordance on a card opens it in the [Widget Workshop](#admin-actions). |
| **Set weather location** | Open the weather card's settings → enter a location (and an optional AccuWeather key). |

Layout is saved per user in jkAuth preferences, so your HUD follows you across devices.

### Built-in widgets

Placed by default: **Clock · Weather · Today · Calendar · Systems · Study**.
On the shelf (add them when you want): **Uptime · Progress · Notifications · Pinned ·
Quick Add · Focus · Add Task**. Admin-published widgets also land on the shelf.

### Tasks, focus & calendars (BeigeBoard, surfaced on the HUD)

| Action | How |
|--------|-----|
| **Quick-add a task** | Use the **Quick Add** or **Add Task** widget on the HUD — type a title, press **ADD**. It lands on today and appears in Today/Progress immediately. |
| **Pin a task to the HUD** | In BeigeBoard, open a task's detail panel → **pin**. It mirrors into the HUD's **Pinned** widget. |
| **Focus on one task** | In BeigeBoard, detail panel → **focus**. The HUD's **Focus** widget shows it and dims the rest; **END FOCUS** clears it. |
| **Connect a calendar** | In BeigeBoard → connect **Google**, **Outlook**, or **iCloud** (iCloud uses an app-specific password). Events show on the HUD calendar + Today. |
| **AI task / goal help** | If LazurOS is enabled, BeigeBoard can parse free-text into a task and break a goal into milestones. |

### Account & sign-in (jkAuth)

| Action | How |
|--------|-----|
| **Register** | `auth.jkos.net` → register. **The first real account becomes admin.** |
| **Log in / Remember me** | Standard login; "Remember me" keeps you signed in across browser restarts (30-day refresh). |
| **Continue as guest** | Guest sign-in (when enabled) — **read-only** across the suite. |
| **Two-factor (2FA)** | In your account: enable **TOTP** (authenticator app) and/or **email codes**, and save **recovery codes**. |
| **Theme & accent** | Change once in your profile — it applies to every app and persists (one shared preferences blob). |
| **Log out** | Logs out every device on that login (the whole session family is revoked). |

### Admin actions

| Action | Where / how |
|--------|-------------|
| **Build & publish a widget** | ORDECK **Widget Workshop** (`/widgets`, admin-only). Compose a card from primitives + data sources with a live preview, then **Publish server-wide** — it appears on every HUD's add strip, no redeploy. The **Guide** tab documents every field. |
| **Add an action (write) widget** | In the Workshop, toggle **ACTION**: pick a suite app → pick one of its discovered capabilities (e.g. BeigeBoard *Add a task*) → map each field (a form input, a fixed value, a live slice like `clock.iso`, or skip). Publishing emits pure data — the same shape an AI step will generate. |
| **Deploy** | `staging.jkos.net/deploy/` (admin-gated): **Deploy staging**, or **Promote to Production** (ships the exact commit you tested on staging). |
| **Enable service tokens** | Set `JKOS_SERVICE_CLIENTS="id:secret:scopeA|scopeB"` on jkAuth, then `POST /auth/token` with `client_id`/`client_secret`/`scope` returns a short-lived Bearer for headless cross-app calls. Unset → the endpoint is disabled. |
| **Turn on per-app audience enforcement** | After jkAuth ships audience-bearing tokens, set `JKOS_APP_ID=<registry id>` on a backend so it rejects tokens not minted for it. See [WEAVE.md](WEAVE.md#security-model-maximal). |

### Adding a new app to your portal

Because the portal is **discovery-driven**, weaving in a new app is:

1. Add a row to jkAuth's `app_registry` (id, name, origin, `allowed_roles`, `api_base`,
   `health_path`, `capabilities_path`).
2. (To be *actionable*) serve `GET /api/capabilities` from the app.

ORDECK then launches it, health-probes it, and composes read/write widgets against it —
**with zero portal code changes**. See [WEAVE.md](WEAVE.md).

---

## Developer & operator commands

```bash
pnpm install                          # one workspace install (root); re-run after editing packages/*
pnpm dev                              # run all apps (turbo)
pnpm build                            # build all apps
pnpm --filter @jkos/<app> dev|build   # one app (ordeck | beigeboard | sylibos)
```

Typecheck: ORDECK `tsc --noEmit`; BeigeBoard/SylibOS `tsc -b`; packages `pnpm --filter @jkos/<pkg> typecheck`.

**Deploy** is the controller at `staging.jkos.net/deploy/` (it `git reset --hard origin/<branch>`,
`docker compose up --build -d`, then `docker restart standalone-nginx`). Full build/runtime
detail, cold-start, TrueNAS paths, and gotchas live in [OPERATIONS.md](OPERATIONS.md).

---

## Reference docs

Agent-oriented reference for the monorepo.

| File | Read it for |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Monorepo layout, shared packages, auth/theme flows, build system, runtime topology, env isolation. **Start here.** |
| [WEAVE.md](WEAVE.md) | The suite interconnection fabric: the contract, `@jkos/weave`, capabilities, the command vocabulary, and the security model. |
| [SERVICES.md](SERVICES.md) | Per-service detail: dirs, containers, ports, key files, routes. |
| [OPERATIONS.md](OPERATIONS.md) | Dev commands, Docker build, deploy, cold start, TrueNAS paths, gotchas. |
| [DESIGN.md](DESIGN.md) | Design system: aesthetic, token contract, factory, typography, component classes, per-app constraints. |

**TL;DR for agents**

- One pnpm + Turbo monorepo. `apps/*` = deployable units, `packages/@jkos/*` = shared libraries.
- **Hub** = ORDECK + jkAuth + BeigeBoard + LazurOS. **Pluggable** = SylibOS (+ future).
- Interconnection goes through **[Weave](WEAVE.md)** — `@jkos/weave` (frontend) + jkAuth `app_registry`/`routes/weave.js` (backend). Never hardcode per-app knowledge; discover it.
- Never duplicate auth/theme/preferences logic — import `@jkos/auth-client` (frontend) or `@jkos/auth-middleware` (backend).
- JS Docker images build from the **repo root context**. Per-app contexts break `@jkos/*` visibility.
- Verify with `pnpm build` + per-app `tsc`; Docker build from root is the deploy-time gate.
