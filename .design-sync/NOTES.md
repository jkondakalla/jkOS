# design-sync notes — jkOS

Repo-specific gotchas for syncing this monorepo to claude.ai/design. Read this
before re-running the sync.

## The rules Jag set for this project (2026-07-30)

1. **Light and dark are of EQUAL priority, with separate design philosophies,
   and BOTH must be shown.** Paper-only previews are not acceptable. See
   "Showing both faces" below for the mechanism.
2. **Scope is BeigeBoard + the primitives. Nothing else counts.** A component
   that is neither exported from `packages/ui/src/primitives.tsx` nor reachable
   from `apps/beigeboard` is out of the design spec and is NOT synced.
   "Reachable" means the DESKTOP app actually renders it — being exported from
   `@jkos/cards` is not enough (see the dead-code list below).
3. **The mobile BeigeBoard was never updated off v0 styles.** Nothing that only
   exists in the mobile view may appear on the sheet. See "Keeping mobile off
   the sheet".
4. **Never show the accent-strip-down-the-left card variant.** It is a v0
   giveaway. It survives in `NextCard` and `CarriedStrip` (DayView.tsx) — both
   inside the agenda body, which is why the agenda is excluded.
5. **Keep the sheet small enough to read by hand.** Jag reviews these cards
   manually and cannot check a hundred cells. **Two cells per component**, and
   only where the second one LOOKS different — a `readonly` cell that renders
   pixel-identical to the default is padding, not documentation. Prefer cutting
   a cell to shipping one that teaches nothing.

## The shape of this sync

- `shape: package` — there is no Storybook anywhere in the repo, and no story files.
- The synced surface is **two** packages merged onto one global (`window.JkOS`):
  `@jkos/ui` is `cfg.pkg`, `@jkos/cards` rides in via
  `cfg.extraEntries: ["../cards/src/index.ts"]`. `@jkos/design`
  is UI-only (no React) and contributes the tokens, not components.
- **37 components in scope, 73 cells**: the 21 syncable `primitives.tsx`
  exports (`VU` is the 22nd but the converter drops it), `SettingsDrawer` (the
  only non-primitive BeigeBoard imports from `@jkos/ui`), and 15 of
  `@jkos/cards`.
- **10 excluded** via `componentSrcMap: null`. They stay on the bundle global (a
  design can still call them) but get no card:
  - *Not primitives, not used by BeigeBoard*: `AppShell`, `AsyncView`,
    `CoverArt`, `MatchPanel`, `MediaGrid`, `SettingsSection`, `WidgetShell`,
    `JkOSTheme`.
  - *Dead code inside the kit* — exported but rendered by nobody:
    `CardFrame` (zero `<CardFrame` call sites anywhere in the repo) and
    `YearView` (only reachable via `Calendar view="year"`, which BeigeBoard
    never passes — `App.tsx` only ever sets week / month / day).
  - *Draws nothing of its own*: `Calendar`. It is the week/month/day dispatcher
    BeigeBoard mounts its tabs through, but every pixel it shows belongs to
    `WeekView` / `CalendarView` / `DayView`, which have their own cards. A card
    for it was four duplicate cells.
  Re-check the scope with:
  `grep -rhoE "from '@jkos/(ui|cards)'" -B8 apps/beigeboard/src` — or better, the
  import-extraction snippet used to derive it, since comment prose pollutes a
  naive grep.
- **There is no build step.** The packages are consumed as TypeScript source by
  Vite apps, so `--entry packages/ui/src/index.ts` points at source and esbuild
  bundles it directly. Do NOT go looking for a `dist/` — `turbo build` is a
  no-op for these packages (they have no `build` script).

## Keeping mobile off the sheet

`apps/beigeboard/src/mobile/` is still on v0 styles and must never reach the
design sheet. Two things enforce that:

- **No mobile-only component is synced.** The mobile app's own surfaces
  (`MobileShell`, `MobileSheets`, `MobileWidgets`, `MobileTodayView`,
  `MobileTasksView`) live in the app, not in a synced package, so they were
  never candidates. `apps/beigeboard/src/mobile/App.tsx` is also the ONLY
  consumer of the direct `WeekView` / `CalendarView` imports — the desktop app
  reaches those bodies through the `Calendar` dispatcher instead.
- **The mobile BRANCH is gone from the kit** (2026-07-30, second pass). This is
  the fix for the bug Jag caught: cards were showing the v0 phone agenda.
  `WeekView` and `CalendarView` used to do `if (useBreakpoint() === 'mobile')
  return <WeekAgenda/>`, and the previous attempt at containing that — pinning
  the calendar previews to `<Faces stacked>` for a ~1000px iframe — **was based
  on a wrong model and did not work**. The preview tree is portalled into the
  iframe but still EXECUTES in the parent realm, so `useBreakpoint()` reads
  `window.matchMedia` on the parent — the design app's card frame, which is
  narrow. Iframe width is irrelevant. Nothing at the preview layer can fix this:
  the picker sizes the card, not us.
  So the two un-migrated bodies moved to the app that wants them —
  `apps/beigeboard/src/mobile/views/{MobileWeekAgenda,MobileCalendarMonth}.tsx`
  — and the kit views now render one body at every width. Zero pixel change in
  either app (BeigeBoard already routes phones to `MobileApp` at
  `apps/beigeboard/src/App.tsx:127`, so the kit's branch was only ever reachable
  from `mobile/App.tsx` and from ORDECK's bb-week widget on a narrow window).
  **If you ever reintroduce a `useBreakpoint()` branch inside a synced
  component, it will render in the design picker.**

## The agenda body is excluded

`DayView mode="agenda"` (and `Calendar dayMode="agenda"`) is not shown. BeigeBoard
mounts `dayMode="grid"` only (`apps/beigeboard/src/views/TodayView.tsx`), so the
agenda is unreachable from the app, and it still carries the v0 accent-strip card
(`NextCard`, DayView.tsx ~line 636, plus the same strip in `CarriedStrip`).

## Composing a chip

`.jk-chip` is a SURFACE, not a finished control: hub.css gives it fill, radius and
the mode-gated shadow and nothing else — no padding, no display, no font. The box
comes from the call site, exactly as `cardSurface()`'s docstring says and as
TaskChip / TimeBlock / AllDayBar do it. A bare `<Chip>text</Chip>` renders as a
highlighted RUN OF TEXT, which is not the house look. Always pass the box:

```jsx
<Chip tint={TEAL} style={{ display:'inline-flex', alignItems:'center',
     padding:'5px 8px', fontFamily:'var(--hub-font-sans)', fontSize:11.5 }}>
  <Press variant="rev">Design sync</Press>
</Chip>
```

## Showing both faces

`.design-sync/previews/_faces.tsx` is the shared helper every preview uses:
`<Faces height={N} [stacked]>…</Faces>` renders the cell content twice, once per
face, labelled Paper and Tube.

**Why iframes.** The dark face is gated on `:root[data-mode="dark"]`, so the
attribute must sit on the DOCUMENT element — one document can only ever be one
face. Each face therefore gets its own same-origin iframe, with `styles.css`
linked in and the content portalled across. `stacked` puts the two faces one
above the other; use it for anything needing full card width (the calendar
grids, the drawer, a chrome bar).

Two consequences worth knowing:

- The face labels are rendered in the PARENT document deliberately. The render
  check reads the root's `textContent`, and a root holding only iframes looks
  empty to it and would collapse the card to the floor card.
- **`[RENDER_THIN] variants render identically` now fires on ~38 of 40** and is
  expected: the checker cannot see inside the iframes, so every cell's parent
  text is just "Paper / Tube". This is a real loss of an automated signal — the
  cards ARE distinct (the harness still labels each cell with its export name,
  and the contact sheets show the variation), but distinctness must be confirmed
  by eye from `_screenshots/contact-sheet-*.png` on every re-sync. Do not
  "fix" it by flattening the previews back to one face.

## Fixes that are load-bearing (don't undo these)

- **`packages/ui/package.json` needs the TOP-LEVEL `"types"` field.** The
  converter's `findTypesRoot` reads `pkgJson.types`, not
  `exports["."].types`. Without the top-level field the `.d.ts` scan finds
  0 files and the build dies with `[ZERO_MATCH] no PascalCase exports`. This
  sync added `"types": "./src/index.ts"`.
- **`packages/ui/src/ds-ground.css` is `cfg.cssEntry`.** hub.css deliberately
  sets no `body` rule (in the suite, each app owns its ground — see
  `apps/beigeboard/src/app.css`). Without this file every preview, and every
  design built from the DS, renders jkOS components on browser-default white in
  a default face. The selector is `html body`, NOT `body`: the preview harness
  injects a late `body { background:#fff }` and a bare selector of equal
  specificity loses on source order.
- **Brand fonts are vendored into `.design-sync/fonts/`** (30 `@font-face`
  rules, latin + latin-ext, ~1.3 MB, all SIL OFL). The suite apps load Fraunces /
  IBM Plex Sans+Mono / Big Shoulders from Google Fonts via a `<link>` in each
  `index.html`, so nothing in the repo ships a `@font-face`. A remote `@import`
  is NOT an option here: designs on claude.ai/design render under a CSP that
  blocks external hosts, so they would silently fall back to system fonts.
  Regenerate with the Google Fonts css2 URL from `apps/beigeboard/index.html`.
- **`cfg.dtsPropsFor` hand-writes the props for all 18 `@jkos/cards`
  components.** The ts-morph project is rooted at `@jkos/ui`, so cross-package
  types can't resolve and every cards component otherwise emits
  `[key: string]: unknown` — no API contract at all for the calendar kit.
  Source of truth for these bodies is `packages/cards/src/types.ts` plus each
  component's own `Props` interface.

## Known render warns (triaged, not new)

- `[RENDER_THIN] variants render identically` on ~38 of 40 — the iframe artifact
  described under "Showing both faces". Confirm by eye on the contact sheets.
- `[CSS_RUNTIME] _ds_bundle.css is the runtime-styles stub` — misleading here.
  This DS is not CSS-in-JS; its real stylesheet is `hub.css`, shipped as
  `tokens/hub.css` and reachable from `styles.css`. `_ds_bundle.css` carries
  only the ground from `cfg.cssEntry`. Ignore.
- `Chip` — `live` / `spent` / `upcoming` look nearly identical in a static
  capture on EITHER face **by design**: `.jk-chip-spent` is deliberately *only* `opacity: .68`
  ("a spent chip is the same chip, just behind you"), and `.jk-chip-live`'s ring
  is subtle on the paper face. Not a broken preview.

## Card presentation (cfg.overrides)

Every in-scope component carries `cardMode: "column"` (one cell per row, full
card width) plus a hand-tuned `viewport` sized to the two-face layout:

- side-by-side faces → `940 x (faceHeight + 80)`
- `stacked` faces    → `1040 x (2*faceHeight + 120)`

The face heights themselves live in each preview's `<Faces height={N}>`. Keep the
two in step — a viewport shorter than the faces need clips the tube cell, which
is the easiest way to silently lose half the design system from a card.

`cardMode` is presentation-only and can be applied with a targeted
`preview-rebuild.mjs`. A `viewport` change is grade-keyed and needs a full
`package-build.mjs` first, or capture aborts with `[CONFIG_STALE]`.

## Findings in the repo (not fixed by this sync)

- **`TButton`'s JSDoc is stale.** `packages/ui/src/primitives.tsx` calls it a
  "Compact **mono** text button", but `.jk-tbtn` in hub.css sets
  `font-family: var(--hub-font-serif)` — Fraunces caps, per the Full Press
  comment right above it. The render is correct; the docstring is wrong, and it
  flows verbatim into the `.prompt.md` the design agent reads. One-word fix in
  the source comment.
- **`VU` gets no component card.** The converter's `isComponentName` rejects
  ALL-CAPS names as constants (`/^[A-Z][A-Z0-9_]+$/`), and there is no config
  override for that rule. `VU` is still bundled and callable as
  `window.JkOS.VU` — it just has no preview card or `.d.ts`. Fixing it would
  need a `.design-sync/overrides/dts.mjs` fork; not worth it for one component.
- **`.jk-sub-link` draws its underline with `border-bottom`.** Any consumer
  rendering it `as="button"` must reset only top/left/right borders — a blanket
  `border: none` silently erases the mark. Same trap for `padding: 0` vs the
  class's `padding-bottom: 1px`.
- **`AllDayBar`'s layout object field is `ev`, not `item`.** `AllDayBar.tsx`
  reads `bar.ev.title` while the surrounding kit calls its records `item`
  everywhere else. Passing `{item}` throws and blanks the render with no build
  error. The type is `AllDayBar` in `datetime.ts` (`ev`, `startCol`, `endCol`,
  `continuesLeft`, `continuesRight`, `lane`) — all six fields required.
  Worth renaming to `item` for consistency; this sync only documented it.
- **`.jk-switch` / `.jk-check` have no `:disabled` styling.** Both accept a
  `disabled` prop and both render pixel-identical to their enabled state
  (`.jk-slider:disabled` is the only disabled rule in hub.css). Previews
  deliberately do not show a "disabled" cell, because it would assert a state
  the DS does not render.

## Authoring previews here

- Import everything from `'@jkos/ui'`, including the `@jkos/cards` components.
  The preview compiler shims package imports to `window.JkOS`, which carries
  both packages' exports. In REAL jkOS app code the calendar pieces are imported
  from `'@jkos/cards'` — the preview spelling is a harness artifact.
- Pin every date. The calendar views derive from `today`; `2026-07-30` is the
  Thursday of the Mon 07-27 – Sun 08-02 week used across the previews.
- The calendar views need an explicit height: wrap in
  `<div style={{height: N, display:'flex', flexDirection:'column'}}>` or they
  collapse.
- Set a tight `cfg.overrides.<Name>.viewport` per component; the 900x700 default
  leaves small primitives as ~80% empty paper in the card.

## Groups

Only two groups exist: `general` (from `@jkos/ui`, whose files are flat under
`src/`) and `cards` (from the `../cards/src/` path). Finer grouping is possible
only via `cfg.docsMap` frontmatter, but a doc file REPLACES the synthesized
`.prompt.md` body — which would cost the `## Examples` section built from the
authored previews. Judged not worth the trade; revisit if someone writes real
per-component docs, which would give better prompts AND better groups.

## Re-sync risks

- The `dtsPropsFor` bodies are a hand-maintained COPY of `@jkos/cards`'s props.
  They will silently rot when that package's API changes. On any re-sync, diff
  them against `packages/cards/src/types.ts` and the component `Props`
  interfaces before trusting them.
- `packages/cards/node_modules/@jkos/ui` is a **pnpm-injected copy**, not a
  symlink. After editing `packages/ui/*`, run `pnpm install` or the cards half
  of the bundle builds against stale sources.
- The vendored fonts are pinned to whatever Google Fonts served on 2026-07-30.
  They will not track upstream font revisions.
- Playwright: chromium build `1228` was already cached on this machine, pinned
  by `playwright@1.61.1`. A different machine may cache a different build — check
  `~/.cache/ms-playwright/` and install the matching playwright release, or the
  render check fails with `Executable doesn't exist`.
- The repo pins `pnpm@10.33.4` via `packageManager`; use
  `COREPACK_ENABLE_STRICT=0` if corepack tries to self-provision.

## Building it: the invocation matters (2026-07-30)

```
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules "$PWD/node_modules" --entry packages/ui/src/index.ts \
  --out ./ds-bundle
```

Both flags are load-bearing, and getting either wrong fails QUIETLY — the build
still exits 0, it just silently ships less:

- **`--entry packages/ui/src/index.ts`** sets `PKG_DIR` to the real package dir.
  Without it `PKG_DIR` is `<node_modules>/@jkos/ui`, and `cfgPath()` resolves
  `cfg.*` paths against `PKG_DIR` WITHOUT realpath — so `extraFonts`
  (`../../.design-sync/fonts/fonts.css`) lands in `node_modules/` and is
  "skipped", and the bundle ships with no `@font-face` at all.
- **`--node-modules $PWD/node_modules`** (repo root) sets `workspaceRoot` to the
  git repo. Point it anywhere else — a staged dir in /tmp, or
  `packages/ui/node_modules` — and `cfg.extraEntries: ["../cards/src/index.ts"]`
  "resolves outside the workspace root", so the ENTIRE `@jkos/cards` half is
  dropped: bundle falls 220 KB → 56 KB and all 15 cards cards render empty.

The catch: this is a pnpm workspace, so the root `node_modules` holds only
`.pnpm`, `turbo` and `typescript` — no `react`, no `@jkos/*`. Link them in
first (root `node_modules` is gitignored; `pnpm install` may prune them, so
re-run this when the build can't resolve `react`):

```
ln -sfn "$PWD/node_modules/.pnpm/react@18.3.1/node_modules/react" node_modules/react
ln -sfn "$PWD/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom" node_modules/react-dom
mkdir -p node_modules/@jkos
for p in ui cards design; do ln -sfn "$PWD/packages/$p" "node_modules/@jkos/$p"; done
```
