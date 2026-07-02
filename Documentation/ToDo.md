# jkOS — ToDo

Working backlog of planned-but-not-yet-executed work. Each section is written to be
**self-contained** — a future agent (likely Claude Code) should be able to execute it
without re-deriving context. When a section is done, move it to a "Done" note in the
relevant `Documentation/*.md` and delete it here.

---

## ⚠️ Hard constraints a cold agent MUST know before touching anything

- **Do NOT edit `apps/sylibos/`.** SylibOS is out of suite scope and off-limits until Jag says
  otherwise. So canonicalization does **`bb`→`beigeboard` only**; leave every `sylib`/`sylibos`
  reference (incl. in shared files like manifest/nginx/registry) untouched so they stay
  consistent with the un-migrated app. Revisit only when Jag includes SylibOS.
- **Suite scope = BeigeBoard / jkAuth / jkDeploy / ORDECK / Weave + LazurOS.** LazurOS is in
  active scope as of 2026-06-30 (the refactor — see §3 below). **Skip sylibos** (still off-limits).
- **Docker builds from the repo ROOT context** so `@jkos/*` source-only packages resolve.
  Per-app context breaks shared-package resolution. Shared packages have **no build step**.
- **nginx confs are bind-mounts → RESTART, not reload.** `weave-proxy.conf` +
  `weave-proxy-staging.conf` are **generated** ([../infra/nginx/gen-nginx-weave.mjs](../infra/nginx/gen-nginx-weave.mjs))
  — never hand-edit; run the script, then `--check`.
- **Prod deploy runs `MANAGE_NGINX=0`** ([../infra/scripts/lib-deploy.sh](../infra/scripts/lib-deploy.sh))
  — a new app's server block / proxy blocks are **inert in prod until nginx is manually restarted**.
- **Editing `packages/weave` locally:** pnpm copies it into `.pnpm` — run `pnpm install` after
  editing the package or dev consumers won't see the change.
- **The contract gate must stay green:** `pnpm test:contracts` ([../package.json](../package.json)).
  Its Python half needs `python-jose` (the runtime behind the numeric-`sub` 401 loop).
- **`pnpm check:responsive` must stay green** — the gate pins `@media` breakpoints to
  `packages/design/responsive/breakpoints.ts`; any breakpoint change must update both.
  It now also enforces that `MEDIA` **derives** every bound from `BREAKPOINT_MAX` (no hardcoded
  breakpoint literals — it's what `useBreakpoint` feeds `matchMedia`) and that `BREAKPOINT_MAX`
  stays one below the next `BREAKPOINTS` `minWidth`. Change tier numbers in **one** place and let
  the rest derive; keep `BREAKPOINT_MAX` a **literal-number** object (the gate text-parses it).
- **Editing `packages/cards` locally:** same pnpm-copy gotcha as weave — run `pnpm install`
  after editing the package or dev consumers won't see the change.

---

## 1. Suite consolidation — remaining deferred items

**Status:** R2 (2026-06-24) closed 4 phases (shared CODES vocab, issuer/cookie single-source,
staging nginx generated, STORAGE_KEYS). The `isoDate` single-source item is now also **DONE**
(2026-06-29): ORDECK's local `isoDate` in `apps/ordeck/src/pages/hud/useHudData.ts` now imports
from `@jkos/cards`; BeigeBoard already re-exports it via `lib/theme`. The backend copies
(`apps/beigeboard/backend/server.js` `isoDateStr` + two inline `.toISOString().slice(0,10)`) are
**intentionally left** — that's CJS Node and `@jkos/cards` is a frontend TS package with no build,
so it can't be required there.

- **`APP_IDS` constant — DONE (2026-07-01 preAlpha sweep).** `@jkos/suite-manifest` exports
  `APP_IDS` (runtime, derived from `APPS`) + an `AppId` literal union in `apps.d.ts`; Weave's
  public app-addressing signatures (`suiteApp`/`apiBase`/`appOrigin`, `weaveClient`/`useWeaveList`,
  `fetchCapabilities`/`fetchDatasets`) are retyped `string → AppId`, re-exported from `@jkos/weave`.
  Consumers typed: cards `useCalendarSource(app: AppId)`, ORDECK `CommandRef.app: AppId` (the
  Widget Workshop's app select is the one boundary cast). The hand-written d.ts tuple is guarded:
  the weave test gate asserts d.ts ⇄ runtime parity, and `pnpm new-app`/`--remove` patch BOTH files.
  `extRef` and the collection/connector `app` spec fields deliberately stay `string`
  (external/pre-registration ids).

- **Keyframe/animation alignment — DONE (2026-07-01 preAlpha sweep).** The 13 shared keyframes
  (`spin`, `fadeSlideUp`, `pulseOpacity`, `checkBounce`, `panelIn`, `itemIn`, `modalIn`, `scanRoll`,
  `scanPulse`, `artifactFlash`, `crtExpand`, `introTitleReveal`, `introFadeOut`) + the 9 motion
  utility classes (`.view-enter`/`.panel-enter`/`.item-in`/`.modal-in`/`.crt-expand`/`.intro-title`/
  `.intro-out`/`.now-dot`/`.check-pop`) now live ONCE in `hub.css` (jkAuth via the token mirror).
  The bodies had already converged; the canonical copy keeps the `transform: none` endings + the
  no-fill-mode rule on `.view-enter`/`.panel-enter` (Chromium fixed-position/stacking fix). Only
  bespoke frames stay app-side: BB `paperExpand`/`.paper-expand`, ORDECK `reel-spin`/`ticker-scroll`.

- **Toolchain alignment.** `apps/sylibos` uses React 19 + Tailwind v4 while the rest of the suite
  is React 18 + plain CSS. Deferred until SylibOS is back in suite scope (off-limits until Jag
  says otherwise). *(The last remaining §1 item.)*

---

## 2. Document the ORDECK calendar widgets (low-priority follow-up)

**Status:** The `@jkos/cards` Week/Calendar views are now registered as ORDECK HUD widgets
(2026-06-29) — code complete, `tsc` + `vite build` clean. They ship **shelved** (`bb-calendar`,
`bb-week` in `DEFAULT_WIDGETS`, absent from `DEFAULT_DESKTOP`; `withBuiltins` adds them to existing
saved docs). Wiring: a `selectCalendarItems(bb)` selector + `items`/`todayIso` slices on
`WidgetCtx`, `COMPONENT_REGISTRY['bb-calendar'|'bb-week']` rendering the views read+light (no
`DragAdapter`), `ordeckResolvers` fall back to the accent chain.

**Remaining = live verification only (needs a running ORDECK dev server + BeigeBoard backend):**
add both widgets from the shelf; confirm they render real BeigeBoard items, that the views' own
`useBreakpoint` grid layout doesn't clash with the HUD grid drag, and that select is a clean no-op
(ORDECK has no detail panel for them yet). If you later want select → an ORDECK action, wire an
`onSelect` in the `COMPONENT_REGISTRY` entries. Once verified, fold a one-line note into the ORDECK
widget docs and delete this section.

---

## 3. LazurOS refactor — remaining phases (5, 7, 8 + gate)

> **Resume here next session.** Phases 0–4 + 6 are built, tested, and gate-green (all
> uncommitted on `staging`). Nothing is mid-edit. The only *code* left that isn't blocked on
> Jag's inputs is **Phase 7** (BeigeBoard `/api/ai/*` cutover) — and that one must NOT land
> until LazurOS is actually serving in prod, or BeigeBoard loses AI parse with no replacement
> live. So the real next move is supplying the unblockers (prompts.json, runtimes, Emily
> MAC/IP — see the table at the end of this section), then a live bring-up, then 5 → 7 → 8.
> First decision tomorrow: **commit the Phase 0–4/6 batch** (or keep accumulating).

**Authoritative spec:** repo-root [`LAZUROS.md`](../LAZUROS.md). Execute phases in order; run
`pnpm test:contracts` between each. When the doc disagrees with the code, the code is ahead —
audit first. Architecture overview: `Documentation/ARCHITECTURE.md` § "LazurOS: the AI gateway".

**LazurOS-specific constraints** (on top of the global block above):
- **No hardware facts in code.** Model tags, GPU/CPU names, IPs, MACs, quantizations, tier counts
  are deployment config (`deployment.json`, mounted not baked), never literals in `.js`/`.py`. Every
  swappable piece is a `createXProvider(config)` factory → plain object (no classes). Adding a
  backend = one factory + one line in `lib/composeProviders.js`.
- **Same Docker image runs any hardware** — `deployment.json` is bind-mounted; `deployment.example.json`
  (generic single-node) and `deployment.jag.json` (Luna/Emily reference, TODO MAC/IP) are committed
  templates. The real `deployment.json` is gitignored.
- **Prompt templates + model tags load from config files**, never inline f-strings (same
  composability reason). The worker renders prompts from `prompts.json` and reads model tags from
  `models.json` — both node-local; no content is hardcoded.

**Status — Phases 0–4 + 6 BUILT (2026-06-30), gate-green, all uncommitted on `staging`.** Tests:
`pnpm --filter @jkos/lazuros-backend test` = 14 (queue) + 22 (providers) + 11 (writeback);
`apps/lazuros/worker/test/worker.smoke.py` = 15; `pnpm test:contracts` = 0 drift.
- **P0–P1** — State node + single-source registry (jkAuth migration `015`, origin `''` + launcher
  guard) + SQLite job queue + `ComputeBackend` probe/wake → `202 {job_id}` + owner-scoped `jobs`
  dataset + bearer-gated `/internal`. Hardenings: `user_id` = token `sub` not body; jobs owner-scoped.
- **P2** — `worker/worker.py` (stdlib-only) poll→claim→render→infer→post; `models.json`/`prompts.json`
  config; `lazuros-worker.service`; mocked-State-node test.
- **P3** — `providers/{stt,tts,embedding}.js` are real HTTP clients now (OpenAI-compat STT, Piper/OpenAI
  TTS, Ollama embeddings); `baseUrl` from config.
- **P4** — `providers/webSearch.js` (`searxng` + `ddgs` factories) + composition seam.
- **P6** — State-node delegated write-back (`lib/writeback.js`, deviation from spec's worker-mints-token)
  + jkAuth enrollment documented in `apps/jkauth/.env.example`.
- **Decisions taken** (Jag: "keep going"): web search = **DDGS**; parse-document = **review-first**;
  delegation runs on the State node (secret off compute nodes). All flagged in code comments + memory.

**Remaining:**

- **Phase 2 — Worker daemon (compute-node-side).** *Skeleton DONE 2026-06-30 (uncommitted):*
  `apps/lazuros/worker/worker.py` — stdlib-only (no pip on the compute node), polls
  `/internal/jobs?limit=1` (audit: the real endpoint takes `?limit=N` and always returns PENDING;
  the spec's `?status=PENDING` is ignored), atomically claims, renders the prompt from `prompts.json`,
  infers via the node-local runtime (`LAZUROS_OLLAMA_URL`, Ollama default), posts DONE/FAILED. No model
  tag or prompt string in code — both load from node-local `models.json` / `prompts.json` (`.example`
  templates shipped). `process_once` factored out + driven by `test/worker.smoke.py` (15 assertions:
  happy path, idle, lost-claim-race, unconfigured-cap→FAILED, infer-error→FAILED) against a mocked State
  node — no network/Ollama/DB. Ships `lazuros-worker.service` (no runtime dependency declared) + `.env.example`.
  *Still blocked for e2e:* real `prompts.json` content (Jag) + a reachable Ollama+model. `build_prompt`
  renders generically from the template map now (the loader is the architecture; the prompt text is the
  content decision left to Jag) rather than the spec's hard `NotImplementedError` stub.
- **Phase 3 — Tier 0 providers.** *DONE 2026-06-30 (uncommitted, code-complete; e2e blocked on
  runtimes).* `backend/providers/{stt,tts,embedding}.js` are now real HTTP clients (mirroring
  `inference.js`), not throw-on-call stubs: STT → OpenAI-compatible `/v1/audio/transcriptions`
  (whisper local + cloud), TTS → Piper-native `POST {text}` + OpenAI `/v1/audio/speech` (kokoro/cloud),
  embeddings → Ollama `/api/embeddings` (the edge node already runs Ollama → deployable today). Each
  reads `baseUrl` from config and throws a clear "configure baseUrl" error otherwise; `baseUrl` added to
  both deployment configs. Router triage prompt flows through the worker's `build_prompt('query', …)`
  already. `test/providers.smoke.mjs` mocks `fetch` (22 assertions incl. web search). *Still needs for
  live e2e:* Luna Ollama-Vulkan confirm + a real whisper/piper server + GLaDOS Piper voice. Spec §9.
- **Phase 4 — Tier 1 web search.** *DONE 2026-06-30 (uncommitted, provider + composition seam).* New
  `backend/providers/webSearch.js` `WebSearchProvider` (`{ search(query) => {results} }`) with TWO
  reference factories — `searxng` (clean JSON API) + `ddgs` (HTTP sidecar; the Python `ddgs` lib has no
  clean Node binding) — both normalizing to `{title,url,snippet}`, registered in a new
  `WEB_SEARCH_FACTORIES` map + optional `webSearch` config slot (jag config → `ddgs`). Tested in
  providers.smoke. *Still needs for live e2e:* a running SearXNG or DDGS sidecar + the worker-side
  contextualization step (blocked on prompts, same as Tier 0). Spec §9.
- **Phase 5 — Tier 2 wiring.** *Code already exists (Phase 1 `createWolBackend`); BLOCKED on hardware.*
  Connect the `emily` `wol` `ComputeBackend` for real; verify wake→probe→claim→`qwen2.5` round trip.
  *Needs:* Emily MAC/IP in `deployment.jag.json` + Emily powered with Ollama. No code to write. Spec §9.
- **Phase 6 — Delegation (G1).** *DONE 2026-06-30 (uncommitted, plumbing; e2e blocked on prompts/live).*
  jkAuth enrollment documented in `apps/jkauth/.env.example` (`JKOS_SERVICE_CLIENTS=lazuros:<secret>:beigeboard:write`
  + `JKOS_DELEGATION_CLIENTS=lazuros`) — no jkAuth code change (the G1 infra already exists). **Deviation
  from spec:** the delegated write-back happens on the **State node** (`backend/lib/writeback.js` →
  `weaveServerClient('beigeboard',{actingUser})` on the worker's DONE result), NOT the worker minting its
  own token — so the delegation secret stays off every compute node and reuses the audited weave path.
  parse-task/breakdown-goal → `/api/import` AS the acting user; parse-document → review-first (no
  auto-write); best-effort (a write-back failure records on the job, never voids the result). Wired into
  `routes/internal.js`; `test/writeback.smoke.mjs` (11 assertions, injected client). *Still needs for live
  e2e:* real `prompts.json` so the model emits import-shaped JSON + jkAuth/BB running with the env set. Spec §9.
- **Phase 7 — BeigeBoard migration (G2).** Remove `/api/ai/parse-task` + `/api/ai/breakdown` from
  `apps/beigeboard/backend/server.js`; point FE callers at `runCommand('lazuros', …)`; drop
  `LAZUROS_TOKEN`/`LAZUROS_URL` from BeigeBoard env. (This is the one phase that touches BeigeBoard.)
  Spec §9.
- **Phase 8 — ORDECK widgets.** Publish `WidgetSpec` docs through the Widget Workshop for the `query`
  capability (assistant box) + a job-status list. No ORDECK code changes. (Note: the old MF widget
  `apps/lazuros/widget/` was deleted in Phase 0 — it targeted the removed proxy.) Spec §9.

**Contract-gate additions (LAZUROS.md §10) — add to `pnpm test:contracts` once Phase 7 lands:**
lazuros in `app_registry` seed AND nginx PEERS (already true); `lazuros.jobs` invalidation key matches
between capability + dataset docs (already true); BeigeBoard `CAPABILITIES` no longer contains
`parse-task`/`breakdown-goal`; `LAZUROS_TOKEN` absent from BeigeBoard `.env.example`;
`deployment.example.json` validates against `validateDeploymentConfig`. (LAZUROS.md §10 item 2 —
"lazuros absent from static SUITE_APPS" — does **not** apply: this codebase single-sources the manifest
from `@jkos/suite-manifest`, so lazuros is correctly in both the registry and SUITE_APPS.)

**Open items needing Jag's input** — these (not code) are what stand between "built" and "live":

| Item | Blocks | Notes |
|------|--------|-------|
| **Prompt templates (`prompts.json`)** | live e2e of P2/3/4/6 | **Top unblocker.** Router triage + per-capability templates; the model must emit import-shaped JSON for write-back. Content, not architecture. |
| Luna Ollama version / Vulkan confirm | Tier 0 live | `ollama ps` must show GPU, not silent CPU fallback (RX 560 = Vulkan, not ROCm) |
| Whisper + Piper servers reachable | Tier 0 STT/TTS | Stand up the `baseUrl` endpoints in `deployment.jag.json` (`:8000` / `:5000`); + source/convert the GLaDOS Piper voice |
| DDGS sidecar (or flip to SearXNG) | Tier 1 live | Provider is written for both; jag config points `webSearch` at a `ddgs` sidecar (`:8001`) |
| Emily static LAN IP + MAC | Phase 5 | Fill into `deployment.jag.json` (`TODO_EMILY_*`); DHCP reservation + WoL enabled in BIOS |
| Emily idle-timeout-to-Off | Phase 5 | Implemented on Emily's OS, outside LazurOS |
| jkAuth `.env` enrollment applied on the live box | P6 live | `.env.example` documents it; set `JKOS_SERVICE_CLIENTS` + `JKOS_DELEGATION_CLIENTS` in the real `.env` |

*Resolved this session:* web-search backend → **DDGS** (both impls shipped); `parse-document` → **review-first**.

**Env follow-up (not LazurOS code):** the dev account (`jag` on Emily) isn't in the `docker` group,
so local image builds fail (`/var/run/docker.sock` is root:docker). Fix when convenient:
`sudo usermod -aG docker jag` then re-login. Until then, lazuros image build + deployed `curl` checks
happen only on TrueNAS via jkos-deploy.
