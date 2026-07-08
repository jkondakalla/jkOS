# jkOS — ToDo

The working backlog, rewritten 2026-07-07 after the upgrade program (7 waves: 8 bugs,
8 architecture chunks, 16 testers) completed and the gate went green. Each section is
self-contained — a future agent should be able to execute it without re-deriving context.
When a section is done, fold a one-line note into the relevant `Documentation/*.md` and
delete it here.

---

## ⚠️ Hard constraints a cold agent MUST know

- **Do NOT edit `apps/sylibos/`**, `services/plex-api/`, or `services/recipe-api/` — even
  in suite-wide sweeps. `bb`→`beigeboard` canonicalization never touches `sylib` spellings.
- **Suite scope** = BeigeBoard · jkAuth · jkDeploy · ORDECK · Weave · LazurOS.
- **The gate must stay green after every chunk:** `pnpm test:contracts`. The full
  command/gotcha catalog is [PRIMITIVES.md](PRIMITIVES.md) (pnpm-copy staleness, ORDECK
  build+preview not dev, nginx restart-not-reload, root Docker context, quoted repo path).
- `Documentation/` is the source of truth; when a doc disagrees with code, the code wins —
  update the doc.

---

## 0. Commit the batch ← *do this first*

**Status: blocking everything else.** The tree carries the ENTIRE recent body of work
uncommitted on `staging`: the 7-wave upgrade program (all new tests + backend restructure +
multi-user readiness + break-glass), the BeigeBoard Workshop rework, LazurOS phases 0–6,
the weave session-2 consolidation, the HUD-resize follow-ups, and this documentation
rewrite (PRIMITIVES.md, TESTING.md, ToDo.md; UPGRADE_PLAN/CONSOLIDATION/SUITE_PROBER
retired). Gate is green (typecheck clean, `test:contracts` EXIT 0, prober 0-drift).

Decide: one big reviewable commit vs. a few thematic ones (docs / tests / backend /
lazuros / workshop). Then push `staging` and deploy via `/deploy`, followed by
`pnpm prove --live https://staging.jkos.net` (and the live roundtrip with a token).

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

## 2. Decisions parked for Jag (deferred by design, with rationale)

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

## 3. Smaller open items

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

## 4. After deploy (operational follow-through)

Once §0 ships to staging/prod:

1. `pnpm prove --live https://staging.jkos.net` (+ `--token`) — health, docshape,
   directory, admin gate.
2. `node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>` — the write path
   through the real edge.
3. Set `BREAK_GLASS_TOKEN` in the controller's TrueNAS-side env (`openssl rand -hex 32`)
   and confirm `bash jkos-deploy/scripts/selftest.sh` passes on the host.
4. Confirm `CALENDAR_ENC_KEY` is set in the real BB `.env` (both prod + staging) before
   anyone connects a calendar — adding it later is safe, but earlier rows stay plaintext.
