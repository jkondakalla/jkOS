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
- **Editing `packages/cards` locally:** same pnpm-copy gotcha as weave — run `pnpm install`
  after editing the package or dev consumers won't see the change.

---

## 1. Register `@jkos/cards` views as live ORDECK widgets

**Status:** Deferred from the `@jkos/cards` card-kit session (2026-06-29). The kit is built
and the `@jkos/cards` dep is already in ORDECK's package.json — only the registration and
data-wiring remain.

**Context:** `@jkos/cards` exports `WeekView` and `CalendarView` as self-contained React
components. They run in **read + light** mode when no `DragAdapter` is passed (select /
toggle / quick-add but no internal drag) — exactly right for ORDECK where HUD grid drag
must not clash. They expect `items: CalendarItem[]`, `today: string`, resolvers, and
optional callbacks. The ORDECK HUD widget system has a `component` escape hatch:
`COMPONENT_REGISTRY` in `apps/ordeck/src/hud/registry.tsx` (currently `= {}`).

**Steps (in order):**

1. **Data slice.** In `apps/ordeck/src/hud/useHudData.ts`, expand the `cal` slice OR add a
   dedicated `useWeaveList('beigeboard', 'items')` call that returns the full item array
   (not just today's tasks). The existing `today` string is already available. Alternatively
   use `weaveClient('beigeboard').list('items')` with no filters to pull all items.

2. **WidgetDef entries.** In `apps/ordeck/src/hud/state.ts`, add two entries to the
   `DEFAULT_SHELF` (or a new registry constant):
   ```ts
   { id: 'bb-calendar', label: 'Calendar', component: 'bb-calendar', w: 4, h: 3 }
   { id: 'bb-week',     label: 'Week',     component: 'bb-week',     w: 4, h: 3 }
   ```
   The `component` key must match the string used in `COMPONENT_REGISTRY`.

3. **COMPONENT_REGISTRY entries.** In `apps/ordeck/src/hud/registry.tsx`:
   ```tsx
   import { CalendarView, WeekView } from '@jkos/cards'
   // resolve to a stable sourceColorOf — ORDECK has no sourceOf; use the accent chain
   const ordeckResolvers = {
     accentOf: (_item: any) => 'var(--color-accent)',
     sourceColorOf: (_source?: string) => 'var(--color-accent)',
   }
   COMPONENT_REGISTRY['bb-calendar'] = (props) => (
     <CalendarView items={props.items ?? []} today={props.today ?? isoDate()} resolvers={ordeckResolvers} />
   )
   COMPONENT_REGISTRY['bb-week'] = (props) => (
     <WeekView items={props.items ?? []} today={props.today ?? isoDate()} resolvers={ordeckResolvers} />
   )
   ```
   The `props` object comes from the HUD engine's `data` binding; wire `items` and `today`
   from the data slice via `WidgetSpec` bindings or directly.

4. **Verify:** `pnpm --filter @jkos/ordeck exec tsc --noEmit` clean. Open ORDECK in dev,
   add the widgets from the shelf, confirm Week and Calendar render with real BeigeBoard data,
   confirm no drag clash with the HUD grid drag, confirm select → ORDECK detail (or no-op).

**Constraints:**
- No `DragAdapter` passed → the views are read+light automatically; do not add drag.
- ORDECK has no `getAccent`/`sourceOf` — supply simple resolver fallbacks (accent chain).
- The views use `useBreakpoint()` internally; at HUD card widths they will likely show the
  grid (tablet/desktop). That is correct — the HUD is not a phone screen.

---

## 2. jkAuth — emit `String(sub)` in JWTs (numeric-sub root fix)

**Status:** Deferred. The immediate 401-loop was patched via `verify_sub:False` in
`jkos-deploy/jkos_auth.py`. The root cause (jkAuth signing a numeric `sub`) is still live.

**Context:** `python-jose >= 3.4` and `PyJWT >= 2.10` both reject a numeric JWT `sub`
("Subject must be a string" — RFC 7519 §4.1.2 compliance). jkAuth currently signs
`sub: userId` where `userId` is a SQLite integer. The jkDeploy workaround (`verify_sub:False`)
silences the check Python-side but leaves the non-compliant token in place; future libraries
or a stricter upgrade could re-surface the issue.

**Fix:** In `apps/jkauth/src/tokens.js`, wherever `sub` is set in the JWT payload, wrap it:
`sub: String(userId)`. One-line change; no DB migration (the `users.id` column stays integer).

**Verify:** Mint a new token; decode the JWT header/payload (e.g. `jwt.io`) and confirm `sub`
is a string. Run the full `pnpm test:contracts` gate. Deploy to staging, confirm jkDeploy
promote still works. After this lands, `verify_sub:False` in `jkos_auth.py` can be reverted
to the stricter default.

---

## 3. Suite consolidation — deferred items from R2

**Status:** R2 (2026-06-24) closed 4 phases (shared CODES vocab, issuer/cookie single-source,
staging nginx generated, STORAGE_KEYS). Four items were explicitly deferred.

**Deferred:**

- **`isoDate` single-source** — the `isoDate` helper is now in `@jkos/cards/datetime.ts`
  for calendar views, but there may still be isolated copies in other apps. Audit with
  `grep -rn 'isoDate\|toISOString.*slice(0,10)'` across `apps/` and consolidate.

- **`APP_IDS` constant** — several files reference app IDs as bare strings (`'beigeboard'`,
  `'jkauth'`, etc.). A shared `APP_IDS` const in `@jkos/suite-manifest` would make renames
  refactor-safe and catch typos at typecheck time.

- **Keyframe/animation alignment** — each app currently ships its own `@keyframes` for
  common effects (`led-pulse`, `blink`, `data-flicker`). These should live in `hub.css` and
  be imported once.

- **Toolchain alignment** — `apps/sylibos` uses React 19 + Tailwind v4 while the rest of
  the suite is React 18 + plain CSS. Alignment is deferred until SylibOS is back in suite
  scope (off-limits until Jag says otherwise).
