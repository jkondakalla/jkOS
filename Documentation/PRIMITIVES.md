# jkOS — Primitives (the low-level action catalog)

Every low-level action you can take in this suite — commands to run, functions to call,
components to mount, skills to invoke — with what each is for and how to use it.
Organized by category. When this doc disagrees with the code, the code wins — update this.

Everything runs from the repo root `/media/jag/The Forge/jkOS` (the path has a space —
quote it). Branch `staging`. `apps/sylibos/`, `services/plex-api/`, `services/recipe-api/`
are off-limits.

---

## 1 · Suite commands (root `package.json`)

| Command | What it does |
|---------|-------------|
| `pnpm install` | One workspace install. **Also required after editing any `packages/*` source** — pnpm copies workspace packages into `.pnpm`, so consumers won't see your edit until you re-run this. |
| `pnpm dev` | `turbo run dev` — all apps in dev mode. (ORDECK's vite dev is broken — CJS `codes.js` import chain; verify ORDECK via `build` + `preview` instead.) |
| `pnpm build` | `turbo run build` — all apps. `pnpm --filter @jkos/<app> build` for one. |
| `pnpm typecheck` | `turbo run typecheck` — cheapest whole-suite signal; run first. |
| `pnpm test:contracts` | **The gate.** Chains every hard contract in the suite (§2). Exit 0 = green. Run after every meaningful change. |
| `pnpm prove` | The suite prober — read-only cross-system conformance report (§2.3). |
| `pnpm roundtrip` | The write round-trip — boots the real BeigeBoard backend and drives create→read→update→complete→delete through discovered docs (§2.3). |
| `pnpm new-app <id>` | Scaffold a complete Layer-A-conformant app (§7). `--remove` undoes it. |
| `pnpm check:tokens` \| `check:nginx` \| `check:responsive` \| `check:drag` \| `check:cards` \| `check:hud` | Individual conformance gates (§2.2) — each is also inside `test:contracts`. |
| `pnpm test:cards` | Pure-logic unit tests for `@jkos/design` color + `@jkos/cards` datetime math (49 assertions). |

---

## 2 · Testing & verification

Full reference (what each test asserts, house patterns, how to add one): [TESTING.md](TESTING.md).

### 2.1 The gate — `pnpm test:contracts`

One command, every hard contract. Its links, in order:

| Link | Runs | Guards |
|------|------|--------|
| `--filter @jkos/jkauth test:contracts` | `contracts.mjs` (30) | codes vocab node↔python parity, issuer/cookie single-source, numeric-sub rejection, break-glass gates |
| `--filter @jkos/jkauth test` | `smoke.mjs` (68) + `lifecycle.mjs` (24) + `multiuser.mjs` (27) | auth flows, cookie flags, rotation/reuse, guest/service/delegation, python cross-verify, prefs deep-merge + 409 lock, role-scoped widgets |
| `--filter @jkos/weave test` | `weave.mjs` (39) + `lego.mjs` (83) | docShape, capability/dataset schema, AppId d.ts⇄runtime parity, collection/connector/trigger bricks |
| `--filter @jkos/beigeboard-backend test` | `import.smoke` (39) + `items.smoke` (48) + `delta.smoke` (14) + `contract.smoke` (14) + `calendar.sandbox` (29) | import pipeline, CRUD hardening + reserved-source guard, `?since` cursor, declared==enforced, calendar providers + wipe guard + enc round-trip |
| `pnpm roundtrip` | `roundtrip.mjs` (23) | the discovered write path end-to-end |
| `--filter @jkos/lazuros-backend test` | queue (18) + providers (30) + writeback (11) + worker-e2e (12) | job queue, provider factories, delegated write-back, real worker.py against the real `/internal` API |
| `pnpm test:cards` | `test/cards-logic.mjs` (49) | withAlpha + datetime/lane math (the real functions, transpiled in-memory) |
| `pnpm check:*` × 6 | see §2.2 | static conformance |
| `pnpm prove` | file-mode prober | cross-system topology invariants; exits non-zero on `drift` |

The Python half needs `python3` + `python-jose` (pinned `<3.6.0`).

### 2.2 Individual conformance gates

| Command | Asserts |
|---------|---------|
| `pnpm check:tokens` | jkAuth's static `jkos-tokens.css` mirror + jkos-deploy's mirror are byte-identical to canonical `hub.css` (regen: `pnpm --filter @jkos/jkauth sync:tokens`, `node jkos-deploy/scripts/sync-tokens.mjs`); plus `test/tokens-parity.mjs` — paper/dark accent-family SET parity + CRT knob ownership. |
| `pnpm check:nginx` | `weave-proxy.conf` + `weave-proxy-staging.conf` match what `infra/nginx/gen-nginx-weave.mjs` derives from the manifest. Fix = regenerate, never hand-edit. |
| `pnpm check:responsive` | All `@media` bounds equal `packages/design/responsive/breakpoints.ts`; `MEDIA` derives from `BREAKPOINT_MAX`; tap-target floor on the right primitives. |
| `pnpm check:drag` | The drag-unification invariants (one `usePointerDrag` primitive, no legacy HTML5-DnD reintroduction). |
| `pnpm check:cards` | Kit purity: no app ids, no host CSS classes, no `` `${x}NN` `` alpha-concat inside `@jkos/cards`/`@jkos/ui` (`withAlpha` is the one blessed path). |
| `pnpm check:hud` | ORDECK HUD doc validity + `mergePublished` idempotency, using the REAL healer. Also a fleet tool: `node apps/ordeck/scripts/check-hud-doc.mjs <file.json>` validates a doc/profile/DB export; `--live` checks the deployed profile. |

### 2.3 The prober — live and write modes

```bash
pnpm prove                                            # file mode (in the gate)
node packages/suite-prober/prove.mjs --json           # machine report
node packages/suite-prober/prove.mjs --live https://staging.jkos.net   # deployed-stack smoke
#   add --token <jwt> (or PROBE_TOKEN=) to check the authed directory + gated docs
node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>   # live WRITE check
#   safe on staging — only touches its own ext_ref:'prober:*' rows, sweeps them after
```

`prove --live` catches "green in git, dead in prod": health 404s at the edge, served docs
failing `checkDocShape`, registry drift, an admin gate that stopped 401ing. Exits non-zero
on drift, so it can gate a post-deploy smoke.

Findings classify as `drift` (two sources disagree — fails) · `consolidate` · `gap` ·
`info` · `ok`. To extend: a new source-of-truth file → `SOURCES` in
`packages/suite-prober/src/sources.mjs`; a new app's docs → `BACKEND_DOCS` same file; a new
invariant → drop `NN-name.mjs` in `src/probes/` (auto-loaded).

### 2.4 Per-app tests (localize a gate failure)

```bash
pnpm --filter @jkos/jkauth test                # auth smoke + lifecycle + multiuser
pnpm --filter @jkos/jkauth test:contracts      # codes/issuer/python bridge only
pnpm --filter @jkos/beigeboard-backend test    # all five BB smokes
pnpm --filter @jkos/lazuros-backend test       # queue/providers/writeback/worker-e2e
pnpm --filter @jkos/weave test                 # weave + lego
python3 apps/lazuros/worker/test/worker.smoke.py   # worker unit half (15, mocked State node)
bash jkos-deploy/scripts/selftest.sh           # deploy-pipeline dry-run (read-only; SKIPs cleanly without docker/openssl)
```

### 2.5 Claude Code skills

| Skill | Use it when |
|-------|-------------|
| `/suite-health` | Anything red or suspicious. Runs the check layers in order (typecheck → gate → localized suspects → `prove --live`) and maps failure signatures to known causes/fixes (numeric-sub, nginx drift, pnpm-copy staleness, ORDECK dev, live-gate exposure, `CALENDAR_ENC_KEY`). |
| `/new-tester` | Adding any test. The house-pattern playbook: shape picker (boot-real-server smoke · transpile-pure-logic unit · text-scan gate · prober probe · node↔python bridge), the non-negotiables (throwaway port + temp DB, dev-stub auth, real HTTP, async-spawn trap), and the gate-wiring checklist. |

---

## 3 · Design factory — `@jkos/design` (framework-free)

Full design-language reference (tokens, aesthetic rules, hub.css classes): [DESIGN.md](DESIGN.md).

### Theme building & application

| Call | For |
|------|-----|
| `buildJkOSTheme(config)` | THE per-app theming entry. Pass only what varies — `accent` (pre-login default pair), `light`/`dark` neutrals, `radius`, `fonts`, `responsive` per-tier scale — get back CSS that overrides hub.css INPUTS; the derivation chain recomputes. Never hand-write token CSS. |
| `injectJkOSTheme(config)` | Injects that CSS once as a `<style>` tag (imperative form; React apps use `<JkOSTheme>` from `@jkos/ui`). |
| `applyJkOSMode(mode)` | `'system' \| 'light' \| 'dark'` → sets `data-mode="paper"\|"dark"` on `<html>`, returns `isDark`. The only two attribute values. |
| `applyJkOSTheme({ primary, secondary })` | Writes the user's accent pair onto `--accent-raw`/`--accent-2-raw`. Paper-deepen/dark-glow derive in CSS — the applier computes nothing. |
| `withAlpha(color, fraction)` | Fade any colour safely: hex-concats bare hex, emits `color-mix(… transparent)` for CSS vars. **Never** `` `${color}66` `` in kit/ui code (gated). |
| `ACCENT_SCHEMES` / `matchAccentScheme(p, s)` / `CUSTOM_SCHEME_ID` | The suite-wide accent palette (four preset pairs + Custom). Add/retune a preset by editing `ACCENT_SCHEMES` only; the shared chooser follows. |
| `STORAGE_KEYS` | Canonical localStorage keys (theme cache etc.) — never re-type the strings. |

### Responsive (the viewport axis)

| Export | For |
|--------|-----|
| `BREAKPOINTS` | The tier list — mobile 0 / tablet 768 / desktop 1024. The ONLY place breakpoint numbers live. |
| `BREAKPOINT_MAX` | `{ mobile: 767, tablet: 1023 }` — the literal source; edit tier numbers here, everything derives. |
| `MEDIA` | `matchMedia`-ready query strings, derived — what `useBreakpoint` consumes. |
| `activeBreakpoint(width)` | width → `'mobile' \| 'tablet' \| 'desktop'`. |

`pnpm check:responsive` pins all of this — change numbers in one place and let it verify.

### Tokens + shared classes

`import '@jkos/design/tokens.css'` (canonical hub.css). Static-served apps (jkAuth,
jkos-deploy) use generated mirrors — regen with `pnpm --filter @jkos/jkauth sync:tokens` /
`node jkos-deploy/scripts/sync-tokens.mjs` after any hub.css change (`check:tokens` catches
forgetting). The `.jk-*` / `.led` / `.seg` / hardware class catalog is in
[DESIGN.md](DESIGN.md) § "Shared component classes" and § "Accent bubbles".

---

## 4 · UI primitives — `@jkos/ui` (React)

```ts
import { Bubble, Press, Lab, TButton, ... } from '@jkos/ui'
import '@jkos/ui/tokens.css'   // full-shell apps (ORDECK/BB) — hub.css + the one CRT opt-out
```

| Export | For |
|--------|-----|
| `<JkOSTheme config>` | Mount `buildJkOSTheme` output once at the app root. |
| `<WidgetShell>` | The HUD/widget card chrome (title strip, frame). |
| `<SettingsDrawer>` / `<SettingsSection>` | THE one settings tray, suite-wide — every app mounts it; app extras go in the `extra` slot. No per-app settings panels. |
| `<Bubble tone large>` · `<Press large as>` · `<Sub>` / `<SubLink>` | The two-accent system: primary pressed/struck, secondary flat. |
| `<Well tint>` · `<Sheet>` | Inset container (retintable via `--jk-tint`) · card surface. |
| `<Lab size sans>` · `<TButton quiet>` · `<Pill>` | Mono eyebrow label · compact text button · green status pill. |
| `<Switch>` / `<Check>` (checked, onChange, tint) · `<VU value segments tint>` | Accent-filled toggles · segmented level meter. |
| `<Scanlines>` / `<Vignette>` / `<Scrim heavy>` | CRT veils (token-driven opacity) · modal backdrop. |
| `cx(...)` | Tiny classnames join. |
| `useBreakpoint()` | `'mobile' \| 'tablet' \| 'desktop'`, backed by the canonical breakpoints. The only sanctioned way to branch on viewport in JS. |
| `usePointerDrag()` | THE one drag-gesture primitive (BB calendar + ORDECK HUD grid both ride it). Returns a handle; configure per-gesture with `DragActivation` = `immediate` / `distance` (4px threshold) / `hold` (long-press, touch). Handles capture + click-suppression. Constants: `DRAG_THRESHOLD_PX`, `HOLD_MS`, `HOLD_CANCEL_PX`. Never add a second drag system (`check:drag`). |

---

## 5 · Calendar card kit — `@jkos/cards` (React, app-agnostic)

The shared calendar surface. **Purity contract** (gated by `check:cards`): no app ids, no
host CSS classes, no raw alpha-concat — an ORDECK mount must render identically to a
BeigeBoard tab.

### Views

| Export | For |
|--------|-----|
| `<Calendar>` | Headless dispatcher — renders Day/Week/Month/Year by prop. |
| `<WeekView>` / `<CalendarView>` / `<DayView>` / `<YearView>` | The four faces. Responsive internally via `useBreakpoint` (grid on desktop/tablet, agenda on mobile) — no separate mobile codepath. Without a `DragAdapter` they run read+light (select/toggle/quick-add, no drag) — how ORDECK mounts `bb-week`. `createSource` prop sets the write's `source` (BeigeBoard passes `'bb'`; omit elsewhere). |
| `<CreateDialog>` | The quick-create dialog the views share. |

### Data & behaviour

| Export | For |
|--------|-----|
| `useCalendarSource(app, opts?)` | The lego seam: feeds any view from any Weave peer's `items` dataset — list + create/update/complete/delete ops that funnel through one `run(op)` (a failed write invalidates the list = optimistic rollback, and calls `opts.onError`). |
| `<CalendarDragProvider>` / `useCalendarDrag()` | Kit-owned drag context over `usePointerDrag` (touch = hold-to-drag; 4px click-vs-drag threshold so taps select, movement reschedules). |
| `deriveDaySections(items, todayIso)` | Day agenda sectioning (overdue/morning/…): one shared derivation. |
| `datetime.ts` (via barrel) | ALL date/time/grid math: `isoDate`, `weekStart` (ISO-Monday), time↔fraction, lane packing, month grids. BeigeBoard's `lib/theme` re-exports these — never write a second copy. |
| `cardSurface(opts)` / `chipCheckStyle` / `ACCENT_GLAZE` | The card-surface style factory (elevation, glaze). |
| `DEFAULT_RESOLVERS` / `mergeResolvers` / `DEFAULT_PLAN_RESOLVERS` / `mergePlanResolvers` | Colour/plan resolver chain — hosts inject `getAccent`/`sourceOf`; defaults fall back to the accent chain. |
| `TaskChip` · `TimeBlock` · `AllDayBar` · `TimelinePreview` · `CardFrame` · `Checkbox` · `Eyebrow` · `RecLamp` | The atoms, exported for bespoke composition. `TimeBlock` clamps out-of-window items (06:00–22:00) to an edge sliver with a ▲/▼ marker. |

BeigeBoard-side plan helpers (bench/drill-down: `currentStep`, `isAdrift`, `carriedBench`)
live in `apps/beigeboard/src/lib/plan.ts` — method doc: [PLANNING_METHOD.md](PLANNING_METHOD.md).

---

## 6 · Auth & Weave

### 6.1 Frontend auth — `@jkos/auth-client`

| Export | For |
|--------|-----|
| `authFetch(input, init?)` | THE fetch for any authed call: on `TOKEN_EXPIRED`/`UNAUTHENTICATED` it silently refreshes and retries once. Use it instead of raw `fetch` everywhere a cookie matters. |
| `getProfile()` / `patchProfile(prefs, version?)` | Read/write `users.preferences` (jkAuth). PATCH **deep-merges** server-side; pass the `prefs_version` from `getProfile` to get the optimistic lock (stale → `409` with the fresh blob in `PatchResult`); omit it for fire-and-forget autosaves. |
| `useJkOSPreferences(opts)` | The one preferences hook — loads profile, applies theme, tracks `prefs_version`, and does one refetch-reapply-retry on 409. |
| `getMe()` / `refreshToken()` / `logout()` / `redirectToLogin()` | Session identity / manual silent-refresh / full family logout / login bounce. |
| `applyTheme(theme)` / `normaliseTheme(raw)` | Apply the canonical flat `{ mode, primary, secondary }`; migrate the legacy nested shape on read. |
| `useHudShelf()` / `useSessionKeepalive(ms?)` | HUD shelf state over preferences / periodic keepalive ping. |

### 6.2 Backend auth — `@jkos/auth-middleware` (also re-exported by `@jkos/weave/server`)

| Export | For |
|--------|-----|
| `jkosAuth(opts)` | Express JWT middleware (RS256, JWKS). Prefer `weaveAuth` (§6.4), which wraps it. |
| `verifyToken` / `requireScope` | Manual verify / scope gate. |
| `resolveIssuer()` / `cookieName()` | The single-source issuer + cookie name — never re-type the strings. |
| `CODES` | The shared error vocabulary (`TOKEN_EXPIRED`, `READ_ONLY`, `NO_USER_CONTEXT`, …), mirrored key-for-key in `jkos-deploy/jkos_auth.py` and asserted by the gate. |

### 6.3 Weave frontend — `@jkos/weave`

| Export | For |
|--------|-----|
| `weaveClient(appId)` | The one-call peer SDK: `.list(dataset, filters?)`, `.command(cap, body)`, `.capabilities()`, `.datasets()` — all through the same-origin edge proxy. `appId` is the typed `AppId` union. |
| `useWeaveList(app, dataset, filters?, opts?)` | Reactive read hook — auto-subscribes to the DERIVED invalidation key (`app.dataset`); no caller-typed bus strings. |
| `runCommand(app, cap, body)` | Fire a capability; on success invalidates `cap.invalidates` so subscribed readers refetch. |
| `usePolledResource(fetcher, initial, opts)` / `invalidate(...keys)` / `subscribe(keys, fn)` | The polled-resource + keyed invalidation bus underneath. |
| `useSuiteApps()` | Hydrates the live app directory from `GET /auth/apps` (registry-driven; the static `SUITE_APPS` is only the offline fallback). |
| `fetchCapabilities(app)` / `fetchDatasets(app)` | Cached doc fetch with eviction on failure. |
| `extRef(app, id)` / `parseExtRef(s)` | The `<app>:<id>` cross-app provenance convention for `ext_ref` columns. |
| `suiteApp(id)` / `apiBase(id)` / `appOrigin(id)` / `APP_IDS` | Manifest helpers — all typed on `AppId`. |

### 6.4 Weave server — `@jkos/weave/server` (dual CJS+ESM; backends `require` it)

The Layer-A obligations — always via these helpers, never hand-rolled:

| Export | For |
|--------|-----|
| `weaveAuth(opts)` | Identity chokepoint: JWKS→key→dev-stub ladder + prod fatal-guard + delegation normalization. Dev-stub (no key env set) = `sub:1, role:admin` — what every smoke test rides. |
| `weaveWriteGate({ scope })` | Write authorization: guest `READ_ONLY` → service `NO_USER_CONTEXT` (lifted for delegated tokens) → scope check. |
| `weaveCors(originResolver)` / `healthHandler(service)` | Registry-driven CORS / `{ status:'ok', service }`. |
| `serveCapabilities(doc)` / `serveDatasets(doc)` | Serve the discovery docs; validates via `checkDocShape` at boot (throws on malformed). |
| `buildItemFilters(query, spec)` / `filterSpec(filters)` / `coerceWeaveColumn(k, v)` | Declared filters → enforced SQL, from the SAME declaration (declared == enforced). |
| `weaveServerClient(appId, { actingUser? })` | Backend→peer calls: mints/caches a service token via `POST /auth/token`. Read/aggregate by default; pass `actingUser` and (if the client is in `JKOS_DELEGATION_CLIENTS`) per-user writes commit AS that user (G1). |
| `applyDelegation(user)` | Normalizes an `act`-bearing service token to its acting user (run inside `weaveAuth`; you rarely call it directly). |

### 6.5 Lego bricks (Layer D) — pure-data specs → full Layer-A contract

| Factory | One spec buys you |
|---------|------------------|
| `defineCollection(def)` (`@jkos/weave/collection`, zero-dep subpath) | A data type → `.ddl()` (table + delta triggers), typed CRUD `.capabilities`, `.dataset` (+ filters), `.mount(router, db)`. Table/routes/docs cannot drift. The scaffolder's backend is one of these. |
| `defineConnector(def)` (`@jkos/weave/connector`) | An external API/device wrapped as a peer — clean discoverable docs, `.mount(router)` translates server-side (secret never reaches the browser). |
| `createTriggerEngine({ triggers, dispatch })` + `resolveBindings` / `validateTriggerTypes` / `triggerWebhook` / `serverDispatch` | "WHEN capability → DO capability" automation, with the DO body typed-bound to the WHEN's declared `returns` (checked by `validateTriggerTypes`); `serverDispatch` runs cross-app DOs under the triggering user via G1. |

Exemplars + assertions: `packages/weave/test/lego.mjs`.

### 6.6 The app directory — `@jkos/suite-manifest`

`packages/suite-manifest/apps.js` is THE single source for the app directory. One row per
app; jkAuth's registry seed, Weave's `SUITE_APPS`, the nginx peer table, and the prober all
derive from it. `apiBase`/`healthPath`/bus key/scope are all computed from the `id`. Don't
edit it by hand for a new app — use `pnpm new-app` (§7), which patches both `apps.js` and
the `AppId` union in `apps.d.ts` (gate asserts their parity).

---

## 7 · Scaffolding, infra & deploy

| Action | How |
|--------|-----|
| **Create a new app** | `pnpm new-app <id> [--name "Display Name"] [--port 3010]` — emits a weave-wired backend (a `defineCollection` + `.mount`), a themed frontend, root-context Dockerfile + compose entries, and registers the app in the manifest (registry/nginx/prober derive). Then: `pnpm install`, fill `apps/<id>/.env`, add the nginx server block to `standalone.conf`, deploy, restart nginx. `pnpm new-app <id> --remove` undoes it. |
| **Regenerate nginx peer confs** | `node infra/nginx/gen-nginx-weave.mjs` (then `--check`). The two `weave-proxy*.conf` files are GENERATED — never hand-edit. Configs are bind-mounts: **restart** nginx (`docker restart standalone-nginx`), never reload. |
| **Regenerate token mirrors** | `pnpm --filter @jkos/jkauth sync:tokens` and `node jkos-deploy/scripts/sync-tokens.mjs` after any `hub.css` change. |
| **Deploy staging / promote prod** | `staging.jkos.net/deploy/` (admin-gated console). Promote ships the exact commit staging just ran (`PROD_BRANCH=staging`). Details + cold-start: [OPERATIONS.md](OPERATIONS.md). |
| **Break-glass (prod jkAuth down)** | `curl -X POST -H "Authorization: Bearer $BREAK_GLASS_TOKEN" https://staging.jkos.net/deploy/…` — only works while jkAuth is unreachable; inert otherwise. Host-env only. See OPERATIONS.md § Break-glass. |
| **Deploy-pipeline self-test** | `bash jkos-deploy/scripts/selftest.sh` — read-only validation of the recovery path (scripts parse, compose configs validate, nginx conf loads, break-glass gates hold). |
| **Fleet-check HUD docs** | `node apps/ordeck/scripts/check-hud-doc.mjs [<file.json> \| --live]`. |

---

## 8 · Cross-cutting gotchas (the ones that bite)

| Gotcha | Rule |
|--------|------|
| pnpm workspace copies | After editing `packages/*`: `pnpm install`, or consumers keep the stale copy. |
| ORDECK vite dev | Broken (CJS `codes.js`). Verify via `pnpm --filter @jkos/ordeck build` + `preview`. |
| nginx bind-mount inodes | Config changes need `docker restart standalone-nginx` — `reload` re-reads the stale inode. Prod deploys never touch nginx (`MANAGE_NGINX=0`); new peers are inert in prod until a manual restart. |
| Docker context | Every JS image builds from the **repo root** so `@jkos/*` resolves. Never per-app context. |
| BeigeBoard backend is CommonJS | It `require`s `@jkos/weave/server` (dual-build). Frontend packages are ESM/TS — no mixing. |
| `CALENDAR_ENC_KEY` lifecycle | Adding a key later is safe (dual-read); removing/changing one after encryption breaks those rows. Treat as permanent per instance. |
| Numeric JWT `sub` | jkAuth mints `String(sub)` everywhere; the Python verifier is strict again. Never re-add `verify_sub:False`; keep `python-jose <3.6.0`. The gate catches regressions. |
| The repo path has a space | Quote `"/media/jag/The Forge/jkOS"` in every shell command. |
