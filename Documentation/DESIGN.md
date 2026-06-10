# jkOS — Design System Reference

Reference for visual and UX design work across the suite. Intended for Claude Design
(or any design tool) to produce work that integrates cleanly with the existing codebase.

---

## Token foundation — `@jkos/design`

All visual values are CSS custom properties declared in `packages/design/src/hub.css`.
**Never hardcode colors or radii.** Reference tokens only.

### Core tokens

| Token | Role |
|-------|------|
| `--accent` | Primary brand accent — set at runtime via `applyJkOSTheme` |
| `--hub-bg` | Page background |
| `--hub-surface` | Card / panel surface |
| `--hub-border` | Divider / stroke |
| `--hub-text` | Primary text |
| `--hub-text-muted` | Secondary / label text |
| `--hub-radius` | Standard border-radius (cards, inputs) |
| `--hub-radius-sm` | Tight radius (chips, badges) |

### Modes

Two modes are set via `data-mode` on `<html>`:

- `data-mode="paper"` — light mode (warm off-white)
- `data-mode="dark"` — dark mode

Mode is applied by `applyJkOSMode()` from `@jkos/design`. Components must use tokens
and respond to mode via `[data-mode="dark"] .component { … }` selectors, not hardcoded
`prefers-color-scheme` media queries. jkOS controls mode explicitly, not via OS preference.

### Accent

`--accent` is injected at runtime from the user's stored preference. Design components
must derive interactive states (hover, focus-ring) from `--accent` directly rather than
defining fixed colors.

---

## Per-app design contexts

### ORDECK — `apps/ordeck`

**Role:** Hub portal / launcher. First thing users see.

- Tailwind v3 + `@jkos/ui` tokens (`packages/ui/src/tokens.css` re-imports hub.css).
- Additional vars: `--crt-scanline-opacity` (CRT overlay effect), toggled by ORDECK's
  own preferences hook extension.
- Widget system: each widget in `src/widgets/` is a self-contained card. Use `WidgetShell`
  from `@jkos/ui` as the outer wrapper — it handles consistent padding, border, radius.
- AppLauncher grid: icon + label tiles, 2-column on mobile, 4-column+ desktop.
- Typography: system-ui stack; no custom font loaded by default.

### BeigeBoard — `apps/beigeboard`

**Role:** Calendar + task manager hub app.

- Vite SPA, React 18. `src/lib/theme.ts` handles app-specific helpers (date formats,
  `halate` color utility, accent-tinted palette) **on top of** the shared jkOS theme.
- Design character: clean productivity tool, high information density, no decorative flair.
- Date/time display: format helpers live in `src/lib/theme.ts` — reuse, don't add new ones.
- Sidebar navigation pattern: icon rail (collapsed) or icon+label (expanded).

### SylibOS — `apps/sylibos`

**Role:** OCW library / learning platform. Pluggable app (served at `sylibos.jkos.net`,
path-routed under `staging.jkos.net/sylib/`).

- Vite SPA, **React 19** + **Tailwind v4** (inline CSS approach — no `tailwind.config.js`
  class list; uses `@theme` / `@layer` / arbitrary properties). **Do not add Tailwind v3
  syntax** (e.g. `bg-[#hex]` is fine; `theme()` calls in CSS are not).
- `src/lib/theme.ts` stores SylibOS **color scheme presets** (named palettes); user picks
  one and it is persisted via `@jkos/auth-client`'s `patchProfile`. The jkOS global
  `applyTheme` still runs; SylibOS simply seeds `--accent` and `data-mode` from the
  chosen preset before the global applier runs.
- Design character: academic / library aesthetic. Clean type-forward layouts. Card grids
  for course browsing; detail pages are text-heavy with sidebar nav.
- CourseProcessor output surfaces (`/api/processed`): concept tree, chunked lessons,
  exercises, videos — design as reading/study views, not dashboards.

---

## Layout constraints

- **Max content width:** `72rem` (hub shell); pluggable apps may go wider for their
  own content areas but should not exceed viewport width on mobile.
- **Sidebar:** fixed-width, not resizable. ORDECK widget shell uses a consistent gutter.
- **Spacing scale:** use Tailwind or CSS `calc()` from a 4px base grid. No arbitrary
  pixel values outside the 4px grid except 1px borders.
- **Z-index layers:** modals > dropdowns > sticky headers > base content. Document any
  new layer added.

---

## Component conventions

### Forms / inputs

- All interactive elements must have visible focus rings using `--accent` (not removed
  for aesthetics). `outline: 2px solid var(--accent); outline-offset: 2px;` minimum.
- Labels always present (visually or via `aria-label`); never placeholder-as-label.

### Icons

- Lucide React is the icon library used across the suite. Import named SVG components;
  do not bundle icon fonts or use emoji as icons in UI chrome.
- Icon sizing: `16px` inline, `20px` standalone action, `24px` hero/empty-state.

### Buttons

- Primary: `background: var(--accent); color: white`.
- Secondary / ghost: border + transparent background; hover fills `--hub-surface`.
- Destructive: red — use a static `--color-destructive: oklch(55% 0.18 25)` token; do
  not tint from `--accent`.

### Cards

- `background: var(--hub-surface); border: 1px solid var(--hub-border); border-radius: var(--hub-radius)`.
- Hover state lifts with a subtle `box-shadow` increase or `border-color` shift to
  `--accent` — pick one per app and be consistent.

---

## Animation / motion

- Prefer CSS transitions (`200ms ease`) for state changes (hover, expand, collapse).
- Page transitions: crossfade or slide — must complete in ≤ 300ms.
- No looping ambient animations in UI chrome (loading spinners excepted).
- Respect `prefers-reduced-motion`: wrap decorative transitions in
  `@media (prefers-reduced-motion: no-preference) { … }`.

---

## What NOT to change

- `packages/design/hub.css` token names — renaming a token breaks every consumer at once.
- `data-mode` attribute contract — mode must remain `"paper"` or `"dark"`; no new values.
- `applyJkOSMode` / `applyJkOSTheme` call signatures in `@jkos/design` — backends and
  frontends both rely on these being stable.
- Container names or Docker network names — ops scripts reference them by name.
- The `JKOS_AUTH_PUBLIC_KEY` / `JKOS_AUTH_PRIVATE_KEY` naming convention — propagation
  scripts pattern-match these exact variable names.
