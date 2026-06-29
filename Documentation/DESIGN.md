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

It is **skeuomorphic, not flat-SaaS**: corners are sharp **by default**
(`--hub-radius: 0px`, max 2px), chrome is built from CSS "hardware" — LEDs, screws, vents,
dymo tape, rubber stamps, 7-segment displays. Subtle ambient animation (LED pulse, data
flicker) is part of the identity. New UI should extend this language, not normalize it
toward generic modern UI. Corner radius is a **per-app factory input** — co-equal with
accent, fonts, and neutrals, not a fixed identity apps "override." The hub default is sharp
(0–2px), but an app picks its own corner scale through the factory without leaving the
language: BeigeBoard runs a rounder scale (`injectJkOSTheme({ radius })`, ~8–11px) for a
warmer paper feel; other apps keep the sharp default. App shapes read the `--hub-radius*`
tokens (never hardcode a pixel radius), so the whole app retunes from that one call.

## Token source of truth — `@jkos/design/tokens.css`

hub.css is split into **INPUTS** (the only things that vary per app) and a universal
**DERIVATION** layer (written once, never duplicated):

```
--accent-raw / --accent-2-raw        ← the user's pair (the ONLY accent defaults)
   ↓  paper: deepen toward ink   |   dark: raw
--accent / --accent-secondary
   ↓
--hub-amber* / --hub-cyan* / --color-*   (all derived)
```

| Layer | Tokens | Role |
|--------|--------|------|
| **Accent inputs** | `--accent-raw`, `--accent-2-raw`, `--accent-deepen-ink` | The user's pair (default = `ACCENT_SCHEMES[0]`, amber·cyan). The **only** accent defaults. `applyJkOSTheme` sets these at runtime. |
| Neutral inputs | `--hub-bg-0..4`, `--hub-screen*`, `--hub-metal-0..2`, `--hub-bevel-*`, `--hub-line*`, `--hub-cream*` (text) | Per-app palette — supplied via `buildJkOSTheme()`, else hub defaults |
| Radius / fonts inputs | `--hub-radius*` (sharp by default), `--hub-font-mono/sans/seg/serif` | Per-app via `buildJkOSTheme()` |
| **Derived** accent chain | `--accent`, `--accent-secondary` | Paper deepens the pair for legibility; dark uses it raw + glow. **Do not hardcode `--accent`** — let it derive. Component code uses the `--color-accent*` aliases, not these. |
| **Derived** families | `--hub-amber/-bright/-dim/-deep/-glow`, `--hub-cyan/-dim/-glow` | Track `--accent` / `--accent-secondary` in **both** modes via `color-mix` |
| Status | `--hub-red/green/magenta`, `--color-ok/warn/danger` | Semantic — never tint from `--accent` |
| Semantic aliases | `--color-paper/card/ink/muted/faint/line/accent/secondary…` | Component-facing aliases onto `--hub-*` — defined **once** here; prefer these in app code |
| Shell layout | `--hub-header-h`, `--hub-bus-h/footer-h`, `--hub-sidebar-w`, `--hub-rail-w`, `--hub-widget-pad`, `--hub-title-h` | Fixed chrome dimensions |
| Effects | `--grain-opacity/blend`, `--crt-scanline-opacity`, `--crt-vignette-opacity`, `--hub-glow-mul`, `--hub-shadow-*` | Mode-dependent atmosphere |
| Accent press | `--hub-accent-press` | "Pressed into the paper" deboss (light) / emissive glow (dark) |

**Hard rules:** do not rename `--hub-*` tokens. **Both accents are user-driven and
co-equal** — secondary is a vivid accent, never a neutral. The only *designed* defaults
are neutrals (light/dark backgrounds + readable text). Apps **must not** bake `--accent`
or restate the derivation; they supply only inputs through `buildJkOSTheme()`. Never
hardcode hex in components — everything resolves through the chain.

## Theme factory — `buildJkOSTheme()`

Apps no longer hand-write token CSS. They call `buildJkOSTheme(config)` (`@jkos/design`)
with the inputs that vary — default accent pair, light/dark neutrals, radius, fonts — and
get back the CSS overriding the hub.css inputs; the universal derivation recomputes from
them. Inject once via `<JkOSTheme config>` (`@jkos/ui`) or `injectJkOSTheme()`. Friendly
keys map 1:1 onto `--hub-*` (`bg0→--hub-bg-0`, `creamBright→--hub-cream-bright`, …); omit a
key to inherit the hub default. `selector` (default `:root`) scopes a subtree, e.g.
`'html.od-v2'`.

## Mode & theme application

- `applyJkOSMode(mode)` (`@jkos/design`) — accepts `'system' | 'light' | 'dark'`, sets
  `data-mode` to `"paper"` or `"dark"` (those are the only two attribute values), returns `isDark`.
- `applyJkOSTheme({ primary, secondary })` — writes the pair onto `--accent-raw` /
  `--accent-2-raw`. The per-mode treatment (paper deepens for legibility; dark is raw +
  glow) is derived in hub.css, so the applier no longer computes it — this removed the old
  double-deepen and the `customAccent` exception (every pick now deepens on paper).
- Apps call `applyTheme` from `@jkos/auth-client`, which takes the canonical **flat**
  theme `{ mode, primary, secondary }` (stored in jkAuth `users.preferences`, synced via
  `PATCH /auth/profile`); `normaliseTheme` migrates the legacy nested shape on read.
- **Accent chooser — five slots, suite-wide.** The accent palette is defined once in
  `@jkos/design` as `ACCENT_SCHEMES` (four named preset pairs) plus a Custom slot. The
  shared `SettingsDrawer` renders exactly these five: picking a preset writes its pair;
  picking Custom reveals dual colour pickers. The active slot is **derived** from the
  stored `{ primary, secondary }` via `matchAccentScheme()` — nothing extra is persisted,
  so the flat theme contract is unchanged. Add/retune a preset by editing `ACCENT_SCHEMES`
  only; the chooser and `DEFAULT_THEME` follow automatically.
- **Design implication:** every screen must hold up in both modes and under any user-chosen
  accent. Dark-mode styling hangs off `[data-mode="dark"]` selectors — **never**
  `prefers-color-scheme` media queries (jkOS controls mode explicitly).

## Typography

- `--hub-font-mono` — **IBM Plex Mono**: data, labels, eyebrows, hardware tape text.
- `--hub-font-sans` — **IBM Plex Sans**: body copy.
- `--hub-font-seg` — **Big Shoulders Display**: 7-segment numeric displays (`.seg`).
- `--hub-font-serif` — defaults to the sans stack; apps wanting a serif set it via the
  factory (`injectJkOSTheme({ fonts:{ serif } })`). BeigeBoard → **Fraunces** for headings
  and numeric figures; SylibOS → Fraunces for reading surfaces.
- Loaded from Google Fonts per app `index.html` (ORDECK additionally loads VT323, Orbitron,
  Space Grotesk, Inter; SylibOS + BeigeBoard load Fraunces).
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

## Accent bubbles — the two-accent pressed/flat system

The pair flows from the chain (`--accent` / `--accent-secondary`), so it deepens for paper
and goes raw + glow for dark automatically. One rule: **primary is struck/pressed** (lit
top face + accent-dark bevel on paper; halation glow in CRT); **secondary stays flat**, one
rung down, never pressed. Status colours keep their own lane.

- **Classes** (hub.css): `.jk-press` / `.jk-press-lg` (struck primary text), `.jk-sub` /
  `.jk-sub-link` (flat secondary), `.jk-well` (inset container), `.jk-bubble` +
  `.jk-bubble-primary` / `.jk-bubble-secondary` (+ `.jk-bubble-lg`) single-element pills,
  `.jk-sheet` (card). Text-system primitives: `.jk-lab` (+ `.jk-lab-sm/-xs`, mono uppercase
  label), `.jk-tbtn` (+ `.jk-tbtn-quiet`, compact mono text button that hovers to the
  secondary accent), `.jk-pill` (green status pill). Corners follow the per-app
  `--hub-radius*` scale (sharp by default); no texture/effect tokens touched.
- **React components** (`@jkos/ui`): `<Bubble tone large>`, `<Press large as>`, `<Sub>`,
  `<SubLink>`, `<Well>`, `<Sheet>`, `<Lab size>`, `<TButton quiet>`, `<Pill>` (+ `cx`) wrap
  those classes — the sanctioned way to use the system. `@jkos/design` stays framework-free
  (tokens + factory + appliers); React lives in `@jkos/ui`.

## Per-app stacks — critical constraints

| App | React | Styling | Notes |
|-----|-------|---------|-------|
| ORDECK | 18 | Plain CSS + `@jkos/ui` | **No Tailwind.** `WidgetShell` from `@jkos/ui` wraps widgets; `@jkos/ui/tokens.css` re-imports design tokens + ORDECK CRT overlay vars only (the `--color-*` aliases now live once in hub.css). v2 HUD (`html.od-v2`) keeps its own neutrals/rounded radius; accent flows from the chain |
| BeigeBoard | 18 | Plain CSS (`src/app.css`) | **No Tailwind.** App helpers (fonts, colors, date fmt) in `src/lib/theme.ts` (date/time math re-exported from `@jkos/cards/datetime.ts` — single source). Restyled to the Claude brief via `@jkos/ui` primitives + per-app factory inputs (serif → Fraunces, a rounder radius scale ~8–11px); accents stay user-driven. Calendar drag uses a 4px click-vs-drag threshold (`providers/DragProvider`) so taps select/create and only real movement reschedules. Week + Calendar tabs use `@jkos/cards` `WeekView`/`CalendarView` — fully responsive (grid on desktop/tablet, agenda on mobile via `useBreakpoint()`); desktop wrappers in `views/` inject `DragAdapter` + colour resolvers; no separate mobile codepath |
| SylibOS | 19 | **Tailwind v4** (CSS-first) | Config lives in `src/index.css` `@theme` block — there is **no `tailwind.config.js`**; don't introduce v3 idioms |

SylibOS specifics:
- `@custom-variant dark` is keyed to `[data-mode="dark"]` — `dark:` utilities follow jkOS
  mode, not the OS setting.
- After `@theme`, the `--color-*` utility vars are remapped to `var(--hub-*)`, so Tailwind
  color utilities resolve through the hub token chain and flip with mode automatically.
  New colors must join this chain, not bypass it.
- Reading schemes in `src/lib/theme.ts` (`SCHEMES`): `reading-room`, `sandstone` (light) /
  `nocturne` (default), `velvet` (dark). `applyScheme` now sets **only** `data-mode` — the
  accent is owned suite-wide by the shared chooser (jkAuth theme → `--accent-raw`), so a
  reading scheme no longer writes `--accent-raw` (that used to fight the unified accent).
  `Scheme.accent` is retained as intended-tint metadata for `useTheme`'s mode-toggle
  matching, not applied. Adding a scheme = adding to `SCHEMES`, not new CSS.

## Responsive design system

The token system has a **viewport axis** layered on top of the per-app axis:

**Breakpoints (single source):** `packages/design/responsive/breakpoints.ts` exports
`BREAKPOINTS = { mobile: 0, tablet: 768, desktop: 1024 }`. These are the ONLY breakpoint
values used across the suite — the `@media` blocks in `hub.css` reference the same numbers.
`pnpm check:responsive` (`test/responsive.mjs`) pins both; any mismatch fails the gate.

**Responsive card-scale tokens (inputs in `hub.css`):**

| Token | Controls |
|-------|----------|
| `--hub-fs-bubble`, `--hub-pad-bubble` | `Bubble` / `.jk-bubble` pill text + padding |
| `--hub-fs-pill`, `--hub-pad-pill` | Status `Pill` / `.jk-pill` |
| `--hub-fs-tbtn`, `--hub-pad-tbtn` | `TButton` / `.jk-tbtn` compact button |
| `--hub-fs-lab`, `--hub-fs-lab-sm`, `--hub-fs-lab-xs` | `Lab` eyebrow sizes |
| `--hub-tap-min` | Minimum tap-target height (44px on touch tiers) |
| `--hub-widget-pad` | Widget card internal padding |

Desktop defaults live in `:root`; the `@media (max-width: 1023px)` and
`@media (max-width: 767px)` blocks override the **inputs** — derivation follows automatically.
`buildJkOSTheme({ responsive: { tablet, mobile } })` lets an app tune the overrides.

**`useBreakpoint()` hook** (`@jkos/ui`) — returns `'mobile' | 'tablet' | 'desktop'`; backed
by the canonical breakpoints. Every `@jkos/ui` primitive (`Lab`, `TButton`, etc.) auto-lifts
tap targets when rendered as `<button>`/`<a>` without any per-component media query.

**Calendar card kit — `@jkos/cards`:** the shared Week and Calendar views use
`useBreakpoint()` internally to switch between an interactive grid (desktop/tablet) and an
agenda/month layout (mobile). BeigeBoard's tab wrappers and mobile shell both render the same
kit component — there is no separate mobile codepath. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the full seam description.

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
- Signatures of `applyJkOSMode` / `applyJkOSTheme` (`@jkos/design`, now `{primary, secondary}`)
  and `applyTheme` / `normaliseTheme` (`@jkos/auth-client`); flat theme shape `{mode, primary, secondary}`.
- **Accents are universal and user-driven** — apps never bake `--accent`; per-app identity is
  expressed only through **neutrals/radius/fonts** passed to `buildJkOSTheme()` (plus SylibOS's
  `@theme` remap layer). The derivation chain is written once in hub.css; don't restate it per app.
- No per-app duplication of theme/auth logic — import from `@jkos/*`
  (see ARCHITECTURE.md invariant; the old per-app copies were deliberately deleted).
- **The settings tray is one shared component** — `SettingsDrawer` from `@jkos/ui`.
  Every app mounts it (ORDECK passes app extras like weather via the `extra` slot);
  there are no per-app settings panels. Its AI section is gated on `lazuros.enabled`
  so the jkAuth kill switch hides LazurOS controls everywhere at once.
- **There is one accent chooser, suite-wide** — five slots in `SettingsDrawer`: the four
  `ACCENT_SCHEMES` presets + Custom. The schemes are data in `@jkos/design`; no app defines
  its own accent presets or picker. Edit the palette there, not in app code.
