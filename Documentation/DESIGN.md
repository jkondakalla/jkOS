# jkOS — Design System Reference

For design-focused agents (Claude Design) working on any jkOS frontend. Everything here
is derived from the actual token/applier source — when in doubt, the code wins:
`packages/design/tokens/hub.css` (tokens + shared classes) and
`packages/design/utils/applyJkOSTheme.ts` (mode/accent appliers).

## The aesthetic — two-faced retro hardware

jkOS has one distinctive design identity with two faces, switched by `data-mode` on `<html>`:

- **`data-mode="paper"`** (light) — warm kraft-paper office: tan/cream layered backgrounds,
  dark ink text, brass/metal hardware tones, grain overlay (multiply), burnt-sienna default accent.
- **`data-mode="dark"`** — CRT amber phosphor terminal: near-black warm backgrounds,
  amber `#ffb000` default accent, text glow (`--hub-amber-glow`), scanline/vignette overlays
  (ORDECK), grain overlay (screen).

It is **skeuomorphic, not flat-SaaS**: corners are sharp (`--hub-radius: 0px`, max 2px),
chrome is built from CSS "hardware" — LEDs, screws, vents, dymo tape, rubber stamps,
7-segment displays. Subtle ambient animation (LED pulse, data flicker) is part of the
identity. New UI should extend this language, not normalize it toward generic modern UI.

## Token source of truth — `@jkos/design/tokens.css`

`:root` holds paper-mode defaults; `:root[data-mode="dark"]` holds the CRT overrides.
Every app imports this file, then overrides only its accent personality.

| Family | Tokens | Role |
|--------|--------|------|
| Per-app accent | `--accent`, `--accent-warm`, `--accent-soft` | The **only** sanctioned per-app override surface |
| Backgrounds | `--hub-bg-0`…`--hub-bg-4` | Layered surfaces, darkest/outermost → lightest/innermost |
| Screen | `--hub-screen`, `--hub-screen-line` | Inner "display" panels inside widget frames |
| Hardware | `--hub-metal-0..2`, `--hub-bevel-light/dark` | Bezels, screws, physical chrome |
| Lines | `--hub-line`, `-strong`, `-bright` | Borders/dividers in three weights |
| Primary accent family | `--hub-amber`, `-bright`, `-dim`, `-deep`, `-glow` | Tracks `--accent` via `color-mix`; **overridden at runtime** by `applyJkOSTheme` |
| Secondary accent | `--hub-cyan`, `-dim`, `-glow` | Runtime-overridable secondary |
| Status | `--hub-red/green/magenta`, `--color-ok/warn/danger` | Semantic colors — use these for destructive/success, never tint from `--accent` |
| Text | `--hub-cream`, `-bright`, `-dim`, `-faint` | Ink hierarchy (bright = primary text) |
| Semantic aliases | `--color-paper/card/ink/muted/faint/line/accent…` | Component-facing aliases onto `--hub-*` — prefer these in app code |
| Typography | `--hub-font-mono/sans/seg` | See Typography below |
| Spacing/radii | `--hub-grid: 40px`, `--hub-radius*: 0–2px` | Canvas grid; sharp corners |
| Shell layout | `--hub-header-h: 52px`, `--hub-bus-h/footer-h: 28px`, `--hub-sidebar-w: 200px` (collapsed `40px`), `--hub-rail-w: 56px`, `--hub-widget-pad: 12px`, `--hub-title-h: 34px` | Fixed chrome dimensions |
| Effects | `--grain-opacity/blend`, `--crt-scanline-opacity`, `--crt-vignette-opacity`, `--hub-glow-mul`, `--hub-shadow-*` | Mode-dependent atmosphere |
| Accent press | `--hub-accent-press` | "Pressed into the paper" deboss (light) / emissive glow (dark) — the mode-aware way to make an accent element feel set into the surface |

**Hard rule (stated in hub.css itself):** do not rename `--hub-*` tokens. Per-app
personality is expressed via `--accent`, `--accent-warm`, `--accent-soft` overrides only.
Never hardcode hex values in components — both modes *and* arbitrary user accent colors
must resolve through the token chain.

## Mode & theme application

- `applyJkOSMode(mode)` (`@jkos/design`) — accepts `'system' | 'light' | 'dark'`, sets
  `data-mode` to `"paper"` or `"dark"` (those are the only two attribute values), returns `isDark`.
- `applyJkOSTheme(theme, isDark)` — writes the user's saved accent onto `--accent` +
  the `--hub-amber` family (and `--hub-cyan` family if a secondary is set).
- Apps call `applyTheme` from `@jkos/auth-client`, which takes the canonical **flat**
  theme `{ mode, primary, secondary }` (stored in jkAuth `users.preferences`, synced via
  `PATCH /auth/profile`); `normaliseTheme` migrates the legacy nested shape on read.
- **Design implication:** every screen must hold up in both modes and under any user-chosen
  accent. Dark-mode styling hangs off `[data-mode="dark"]` selectors — **never**
  `prefers-color-scheme` media queries (jkOS controls mode explicitly).

## Typography

- `--hub-font-mono` — **IBM Plex Mono**: data, labels, eyebrows, hardware tape text.
- `--hub-font-sans` — **IBM Plex Sans**: body copy.
- `--hub-font-seg` — **Big Shoulders Display**: 7-segment numeric displays (`.seg`).
- Loaded from Google Fonts per app `index.html` (ORDECK additionally loads VT323, Orbitron,
  Space Grotesk, Inter; SylibOS adds Fraunces + Hanken Grotesk for its reading surfaces).
- The label idiom is `.mono-eyebrow`: 9px mono, uppercase, `0.2em` letter-spacing, dim ink.

## Shared component classes (in hub.css — reuse, don't recreate)

| Class | What it renders |
|-------|-----------------|
| `.led` (+ `.green/.amber/.red/.cyan/.off/.steady/.sm/.lg`) | Pulsing status LED with glow |
| `.screw`, `.vent`, `.perf` | Hardware chrome: screw heads, vent slats, perforation |
| `.label-tape`, `.dymo-tape` | Embossed label strips (dymo is always dark — a physical object) |
| `.stamp` | Rotated rubber-stamp badge |
| `.seg` | 7-segment glowing numeric text |
| `.bar-track` / `.bar-fill` | Amber-gradient meter |
| `.glow`, `.glow-dim`, `.glow-cyan` | Phosphor text glow |
| `.canvas-grid`, `.canvas-cell`, `.boot-sweep` | Grid canvas background, layout cells, boot-in animation |

Keyframes available: `led-pulse`, `blink`, `data-flicker`, `grain`. Scrollbars and
`::selection` are already styled globally — don't restyle per-app.

## Per-app stacks — critical constraints

| App | React | Styling | Notes |
|-----|-------|---------|-------|
| ORDECK | 18 | Plain CSS + `@jkos/ui` | **No Tailwind.** `WidgetShell` from `@jkos/ui` wraps widgets; `@jkos/ui/tokens.css` re-imports design tokens + CRT overlay vars + `--color-*` aliases |
| BeigeBoard | 18 | Plain CSS (`src/app.css`) | **No Tailwind.** App-specific helpers (fonts, colors, date fmt) in `src/lib/theme.ts` |
| SylibOS | 19 | **Tailwind v4** (CSS-first) | Config lives in `src/index.css` `@theme` block — there is **no `tailwind.config.js`**; don't introduce v3 idioms |

SylibOS specifics:
- `@custom-variant dark` is keyed to `[data-mode="dark"]` — `dark:` utilities follow jkOS
  mode, not the OS setting.
- After `@theme`, the `--color-*` utility vars are remapped to `var(--hub-*)`, so Tailwind
  color utilities resolve through the hub token chain and flip with mode automatically.
  New colors must join this chain, not bypass it.
- Preset schemes in `src/lib/theme.ts` (`SCHEMES`): `reading-room`, `sandstone` (light) /
  `nocturne` (default), `velvet` (dark). `applyScheme` sets `data-mode` + `--accent`.
  Adding a scheme = adding to `SCHEMES`, not new CSS.

## Icons

There is **no icon library** in the workspace (no lucide/heroicons/react-icons).
Iconography is inline SVG plus the CSS hardware classes above. Don't add an icon
dependency as part of a design pass — that's an architecture decision, not a polish one.

## Motion

- Ambient hardware effects (LED pulse, occasional `data-flicker`) are the house idiom —
  subtle opacity-only loops are fine; large movement loops are not.
- Entrances use `boot-sweep` (0.4s ease-out). Keep new transitions in that range (~200–400ms).
- CRT scanline/vignette intensity is token-driven (`--crt-*-opacity`) — adjust via tokens,
  never bake overlay opacities into components.

## Invariants — do not change in a design pass

- `--hub-*` token **names** (every consumer references them; hub.css forbids renames).
- The `data-mode` contract: attribute values are exactly `"paper"` and `"dark"`.
- Signatures of `applyJkOSMode` / `applyJkOSTheme` (`@jkos/design`) and
  `applyTheme` / `normaliseTheme` (`@jkos/auth-client`); flat theme shape `{mode, primary, secondary}`.
- The rule that per-app identity lives **only** in `--accent` / `--accent-warm` /
  `--accent-soft` overrides (plus SylibOS's `@theme` remap layer).
- No per-app duplication of theme/auth logic — import from `@jkos/*`
  (see ARCHITECTURE.md invariant; the old per-app copies were deliberately deleted).
- **The settings tray is one shared component** — `SettingsDrawer` from `@jkos/ui`.
  Every app mounts it (ORDECK passes app extras like weather via the `extra` slot);
  there are no per-app settings panels. It is token-driven and mode-aware, and its
  AI section is gated on `lazuros.enabled` so the jkAuth kill switch hides LazurOS
  controls everywhere at once. Don't reintroduce a local settings panel.
- Docker container names and networks (ops reference them by name).
