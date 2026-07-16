# jkOS — Quick Start / Monday Refresher

A one-screen "what is my suite, where is it, what's next" for when you come back to it.
Deeper docs are linked at the bottom. Verified against a green gate on 2026-07-13.

---

## What jkOS is

A **self-hosted productivity suite you own end to end**, running in Docker on your TrueNAS
SCALE box, developed from one pnpm + Turbo monorepo on your desktop (Emily). One sign-in
(jkAuth SSO) unlocks everything; one screen (ORDECK) surfaces it all as a live widget HUD.
Apps discover each other through a shared fabric (Weave) — **adding an app is one registry
row, not portal code**.

Design identity: two-faced retro hardware — warm kraft-**paper** (light) ⇄ amber **CRT**
terminal (dark), skeuomorphic chrome (LEDs, screws, 7-seg), one accent you pick that applies
everywhere.

---

## The systems at a glance

**Five core systems (the backbone):**

| System | One-liner | Where |
|--------|-----------|-------|
| **ORDECK** | The portal — arrangeable widget HUD reading live data from every app; admin-only Widget Workshop builds widgets as pure data, no redeploy | `jkos.net` |
| **jkAuth** | Identity + SSO + the app registry that drives all discovery; RS256 JWTs, 2FA, per-user preferences | `auth.jkos.net` |
| **BeigeBoard** | Your primary data app — goals/milestones/tasks + Google/Outlook/iCloud calendars; the Workshop breakdown method | `beigeboard.jkos.net` |
| **Weave** | The integration fabric — any app reads/writes any peer same-origin through nginx; discovery over hardcoding | `@jkos/weave` |
| **jkDeploy** | One-button staging→prod deploy controller (FastAPI); ships the exact commit staging just ran | `staging.jkos.net/deploy/` |

**Two more apps on the same fabric:**

| App | One-liner | State |
|-----|-----------|-------|
| **LazurOS** | AI gateway — async job queue routing inference to a tier of compute nodes (local always-on + Wake-on-LAN burst); powers BeigeBoard's task-parse / goal-breakdown. No hardware facts in code — a mounted `deployment.json` composes it. | **Built (Phases 0–6), not yet live.** Waiting on you: `prompts.json`, reachable Ollama/whisper/piper, Emily's MAC/IP. |
| **PapyrOS** | Fully-native multi-user audiobook library — own scanner (one folder = one book), Range-streamed playback with a single-timeline player bar, iTunes metadata enrichment, offline caching, per-user resume. | **Live on staging** (`staging.jkos.net/papyros/`). |

*(SylibOS, a study app, also lives in the repo but on a **separate track** — off the suite
contract, don't touch it in suite-wide work. VaultOS, a per-share file browser, is **parked** —
ZFS covers the need; the design survives in [VAULTOS.md](VAULTOS.md).)*

---

## Where things stand right now

- ✅ **Gate is green** — `pnpm test:contracts` exits 0, suite prober reports **0 drift**.
- ✅ **Core five + PapyrOS** are built, committed to `staging`, and deployed. PapyrOS Waves
  1–7.3 are live (playback, metadata, offline).
- 🟡 **LazurOS** is code-complete through Phase 6 but has never run against real inference —
  it needs content/hardware from you, not more code. See [ToDo §1](ToDo.md).
- 🟡 **PapyrOS remaining:** a hands-on live pass with two real logins (6.2), multi-source
  metadata (6.5e), the offline write queue (7.2), and the book-club + "continue listening"
  widget (Wave 8). See [ToDo §2](ToDo.md).
- 🔜 **`@jkos/player` — the media primitive.** One player, three apps: PapyrOS (audiobooks,
  live), a music app (next), a video app (parked). PapyrOS's `position.ts` already *is* the
  timeline core; the program extracts it, adds the queue layer it has never had, and puts
  PapyrOS back on it unchanged. Design: [PLAYER_PARITY.md](PLAYER_PARITY.md). Tasks:
  [ToDo §3](ToDo.md). **Blocked on you: a name for the music app** (the id bakes into
  scope/edge/bus-key).
- ⏸️ **Deferred by choice:** VaultOS ([VAULTOS.md](VAULTOS.md) — ZFS covers it), the video app,
  and a handful of parked design decisions.

**Your shortest path to a win this week:** stand up LazurOS (drop in `prompts.json` + point it
at Ollama), *or* do the PapyrOS 6.2 live pass and publish the two authored LazurOS/PapyrOS
ORDECK widgets — both are "content + a click," not engineering.

---

## Working with it day to day

Everything runs from the repo root `/media/jag/The Forge/jkOS` (**the path has a space —
quote it**). Branch: `staging`.

```bash
pnpm install                 # also required after editing any packages/* (workspace copy)
pnpm dev                     # all apps in dev (ORDECK is build+preview only, not dev)
pnpm build                   # or: pnpm --filter @jkos/<app> build
pnpm typecheck               # cheapest whole-suite signal — run first
pnpm test:contracts          # THE gate — run after every meaningful change; exit 0 = green
pnpm prove --live https://staging.jkos.net --token <jwt>   # post-deploy smoke
```

**Deploy:** `staging.jkos.net/deploy/` → **Deploy Staging** (pulls `origin/staging`), then
**Promote to Production** (ships the same commit). Prod DNS for papyros is still pending, so
promote it later; staging is path-based and works now.

**Three reflexes that save you:**
1. Edited a `packages/*`? `pnpm install` again or consumers keep the stale copy.
2. nginx config: **recreate, don't bare-restart** (`cd infra/nginx && docker compose up -d`) —
   a restart can't add a bind-mount and can take the whole edge down.
3. New app? `pnpm new-app <id> --name "<Name>" --port <port>` scaffolds a gate-conformant
   app and wires the manifest + nginx for you.

---

## Where to go deeper

| Doc | Read it for |
|-----|-------------|
| [README.md](README.md) | Using the suite (portal, tasks, audiobooks, account, admin actions). |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the systems fit — **start here for engineering.** Each app has its own section. |
| [PRIMITIVES.md](PRIMITIVES.md) | The low-level action catalog — every command, factory, hook, gate, skill. |
| [WEAVE.md](WEAVE.md) | The integration contract — what an app implements to weave in. |
| [OPERATIONS.md](OPERATIONS.md) | Build/deploy model, cold start from zero, TrueNAS paths, gotchas. |
| [TESTING.md](TESTING.md) | The gate anatomy, every test and what it asserts, the prober. |
| [DESIGN.md](DESIGN.md) | The design language — tokens, factory, the two faces. |
| [PLANNING_METHOD.md](PLANNING_METHOD.md) | The BeigeBoard breakdown discipline. |
| [ToDo.md](ToDo.md) | The working backlog — only open/future work carries detail. |

**Two skills** automate the common loops: `/suite-health` (run the gate + map failures to
fixes) and `/new-tester` (author a test in the house pattern).
