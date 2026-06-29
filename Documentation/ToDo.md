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
- **Suite scope = BeigeBoard / jkAuth / jkDeploy / ORDECK / Weave only.** Skip lazuros + sylibos.
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
so it can't be required there. These three remain:

- **`APP_IDS` constant.** Several files reference app IDs as bare strings (`'beigeboard'` ×15 in
  in-scope FE, `'auth'`, …). A shared `APP_IDS` const + `AppId` union in `@jkos/suite-manifest`
  would make renames refactor-safe. **Caveat learned 2026-06-29:** the const alone gives no
  typecheck safety — the payoff (typo-catching) only lands if Weave's public app-id-accepting
  signatures (`list(app,…)`, `useWeaveList(app,…)`, `apiBase(app)`, `appOrigin(app)`) are retyped
  from `string` to `AppId`. That's a broad change across the `weave` package (pnpm-copy gotcha +
  the weave test gate), disproportionate for the value — do it only as a deliberate Weave-API pass,
  not a drive-by. (`SuiteApp` is a full-object interface, not the id union, so it doesn't already
  cover this.)

- **Keyframe/animation alignment.** The three the suite shares — `led-pulse`, `blink`,
  `data-flicker` (+ `grain`, `bootIn`) — are **already** consolidated in `hub.css` (and only there;
  jkAuth gets them via the token mirror). What remains is a *broader* dedup: `apps/beigeboard/src/app.css`
  and `apps/ordeck/src/styles/global.css` each redefine ~13 of the SAME keyframes (`spin`,
  `fadeSlideUp`, `pulseOpacity`, `checkBounce`, `panelIn`, `itemIn`, `modalIn`, `scanRoll`,
  `scanPulse`, `artifactFlash`, `crtExpand`, `introTitleReveal`, `introFadeOut`). They differ
  subtly between the two apps (e.g. `pulseOpacity` 0.35 vs 0.45), so moving them to `hub.css`
  needs a careful per-keyframe diff + a visual check of BOTH apps — not a blind move. Lower-value,
  visual-regression risk; left until a dedicated motion pass.

- **Toolchain alignment.** `apps/sylibos` uses React 19 + Tailwind v4 while the rest of the suite
  is React 18 + plain CSS. Deferred until SylibOS is back in suite scope (off-limits until Jag
  says otherwise).

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
