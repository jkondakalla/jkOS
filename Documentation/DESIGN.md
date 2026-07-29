# jkOS Design System — the complete context

**This file is the whole design system in one document.** It is written so a design-focused
agent (Claude Design) needs **no other source in the repo**: every token value, every shared
class, every component API, every rule and every file path it may need is here. Pair it with
the living style guide at **https://staging.jkos.net/design** — the page shows the *look*
(both faces, live mode/accent/corner toggles, every primitive rendered by the real CSS);
this file gives the *values and the rules*.

> **Snapshot honesty:** the value tables below are a faithful copy of
> `packages/design/tokens/hub.css` as of 2026-07-19 (**Full Press Waves 22–26** folded in,
> committed on `staging`). For machines, hub.css remains the source of truth; if this
> doc and the code ever disagree, the code wins — and this doc should be fixed. §14 lists
> the regen commands that keep everything else in sync.

---

## 1. Identity — two-faced retro hardware

jkOS has **one distinctive identity with two faces**, switched by a single attribute:
`data-mode` on `<html>`, whose only legal values are `"paper"` and `"dark"`.

- **`data-mode="paper"`** — a warm kraft-paper office: tan/cream layered stock, dark ink,
  brass hardware tones, film-grain multiplied into the backdrop, burnt-sienna default
  accent. Physical accents: things sink into the sheet or sit raised on it (§4).
- **`data-mode="dark"`** — a CRT amber-phosphor terminal: near-black warm grounds,
  `#ffb000` amber, text glow, scanline + vignette veils, grain screened in. Accents
  **emit** — halation is this face's emphasis.

The character in one paragraph: **skeuomorphic, not flat-SaaS**. Chrome is built from CSS
"hardware" — LEDs, label tape, rubber stamps, perforation, 7-segment readouts — and that
hardware is **scarce punctuation, not decoration**: one LED marks *the* live thing; a strip
of tape names *the* important panel; an LED on everything means nothing is live. Corners
are **soft by default** (6–11px house scale); sharp is a deliberate opt-in. Subtle ambient
animation (LED pulse, occasional data flicker) is part of the identity; large movement
loops are not. There is **no icon library** — iconography is inline SVG plus the hardware
classes. Every screen must hold up in **both faces** and under **any user-chosen accent**.

Mode is controlled explicitly — components never read `prefers-color-scheme`. Dark-mode
styling hangs off `[data-mode="dark"]` selectors, period. (The single sanctioned use of the
OS preference is inside `applyJkOSMode('system')`, which resolves it once and then stamps
`data-mode`.)

---

## 2. The two faces — complete palettes

hub.css is split into **INPUTS** (the only things that legitimately vary per app) and a
universal **DERIVATION** layer written once. These are the input values.

### Paper (`:root`)

| Token | Value | Role |
|---|---|---|
| `--hub-bg-0` | `#ede2c8` | page ground (kraft tan) |
| `--hub-bg-1` | `#e4d5b0` | second layer |
| `--hub-bg-2` | `#f5ead4` | card |
| `--hub-bg-3` | `#ead9bb` | card-2 |
| `--hub-bg-4` | `#f7f1e3` | lightest lift |
| `--hub-screen` / `--hub-screen-line` | `#f0e8d8` / `#d8c8b0` | inner "screen" panels + their border |
| `--hub-metal-0/1/2` | `#d4c8a8` / `#c8bca0` / `#b8a888` | hardware metal ramp (brass-paper) |
| `--hub-bevel-light` / `--hub-bevel-dark` | `rgba(255,252,230,.85)` / `rgba(80,50,20,.18)` | bevel highlights/shades |
| `--hub-line` / `-strong` / `-bright` | `#c8ae88` / `#b09a72` / `#907854` | border ramp |
| `--hub-cream-bright` | `#1c1408` | primary ink |
| `--hub-cream` | `#6b5038` | muted body |
| `--hub-cream-dim` | `#9c8060` | faint |
| `--hub-cream-faint` | `#b8a888` | ghost |
| `--accent-raw` / `--accent-2-raw` | `#ffb000` / `#4ecdc4` | THE only accent defaults (user pair overrides at runtime) |
| `--accent-deepen-ink` | `#2a1c0e` | paper deepen target |

### Dark (`:root[data-mode="dark"]`)

| Token | Value | Role |
|---|---|---|
| `--hub-bg-0..4` | `#11100d` / `#1a1814` / `#232019` / `#2c2820` / `#38321f` | warm near-black ramp |
| `--hub-screen` / `--hub-screen-line` | `#0e0c08` / `#2a2418` | CRT screen wells |
| `--hub-metal-0/1/2` | `#2a2620` / `#3a342b` / `#4a4234` | dark metal |
| `--hub-bevel-light` / `--hub-bevel-dark` | `rgba(255,220,160,.06)` / `rgba(0,0,0,.5)` | |
| `--hub-line` / `-strong` / `-bright` | `#3a3528` / `#4a4232` / `#6a5d3e` | |
| `--hub-cream-bright` | `#efe6c9` | primary ink |
| `--hub-cream` | `#d6cba8` | muted |
| `--hub-cream-dim` / `-faint` | `#8a8067` / `#5a543f` | |

### Status — semantic constants, never accent-derived

| Token | Paper | Dark |
|---|---|---|
| `--hub-red` (danger) | `#b42010` | `#ff4530` (dim `#6b1c14`) |
| `--hub-green` (ok) | `#2a7040` | `#5cd66a` |
| `--hub-magenta` (accent-free data hue) | `#8a2060` | `#ff5d8f` |
| `--color-ok` | `#2a7040` | `#34d399` |
| `--color-warn` | `#a04010` | `#fbbf24` |
| `--color-danger` | `#b42010` | `#f87171` |

Soft status fills derive once: `--hub-green-soft` / `--hub-red-soft` / `--hub-warn-soft` =
`color-mix(status 10–12%, var(--hub-bg-2))`.

---

## 3. The accent chain — the one derivation

**Both accents are user-driven and co-equal** — a vivid primary and a vivid secondary,
never a neutral. Apps supply only a *default* pair; the live pair is the signed-in user's
(flat theme `{ mode, primary, secondary }`, stored in jkAuth `users.preferences`, applied
by `applyTheme` from `@jkos/auth-client`). From two raw inputs everything derives:

```
--accent-raw / --accent-2-raw            (the user's pair)
   │  paper: deepen toward ink              dark: keep raw
   ▼
--accent           = color-mix(in srgb, var(--accent-raw)   64%, var(--accent-deepen-ink))   [paper]
                   = var(--accent-raw)                                                        [dark]
--accent-secondary = same treatment on --accent-2-raw
   ▼
primary family  (tracks --accent):
  --hub-amber        = var(--accent)
  --hub-amber-bright = color-mix(accent 55%, #ffffff)                 (both modes)
  --hub-amber-dim    = color-mix(accent 72%, #1a0a00)  [paper]  · 72%, #1a1400 [dark]
  --hub-amber-deep   = color-mix(accent 20%, bg-2)     [paper]  · 26%, #000    [dark]
  --hub-amber-glow   = color-mix(accent 30%, transparent) [paper] · 38% [dark]
secondary family (tracks --accent-secondary):
  --hub-cyan         = var(--accent-secondary)
  --hub-cyan-dim     = color-mix(secondary 60%, #000)  [paper]  · 50% [dark]
  --hub-cyan-glow    = color-mix(secondary 25%, transparent) [paper] · 38% [dark]
```

**Component-facing aliases** (use these in app code, not the families):
`--color-paper`(bg-0) · `--color-paper-2`(bg-1) · `--color-card`(bg-2) · `--color-card-2`(bg-3)
· `--color-ink`(cream-bright) · `--color-muted`(cream) · `--color-faint`(cream-dim)
· `--color-line`/`-strong` · `--color-accent`/`-bright`/`-dim`/`-deep`/`-glow`
· `--color-accent-soft` (12% over card) · `--color-accent-ink` (accent 80% black on paper,
78% white in dark — readable accent type) · `--color-accent-contrast` (#fff paper / #000 dark)
· `--color-secondary`/`-dim`/`-glow`.

**On-accent ink** — text sitting ON the accent or a data colour uses the constant
white-alpha family, not `--color-ink`: `--color-on-accent` `rgba(255,255,255,.95)` /
`-dim` `.7` / `-faint` `.45`.

**Shadow / emphasis tokens:**

| Token | Paper | Dark |
|---|---|---|
| `--hub-shadow-inset` | `inset 0 1px 0 bevel-light, inset 0 -1px 0 bevel-dark` | same (dark bevels) |
| `--hub-shadow-card` | `0 2px 8px ink@10%, 0 0 0 1px line` | same formula |
| `--hub-accent-press` (the WELL shadow) | `inset 0 2px 3px ink@32%, inset 0 -1px 1px #fff@55%, 0 1px 0 #fff@45%` | `0 0 10px tint@38%, inset 0 0 0 1px tint@30%` (emissive; reads `--jk-tint`) |
| `--accent-halo` / `--accent-halo-text` | `none` / `none` | `0 0 16px accent-glow` / `0 0 12px accent-glow` |
| `--hub-glow-mul` | `0.5` | `1` |

**The five accent slots (suite-wide chooser, `ACCENT_SCHEMES` in `@jkos/design`):**

| id | label | primary | secondary |
|---|---|---|---|
| `amber-cyan` (house default) | Amber · Cyan | `#ffb000` | `#4ecdc4` |
| `green-violet` | Green · Violet | `#5cd66a` | `#c08aff` |
| `ice-coral` | Ice · Coral | `#a8d8ff` | `#ff6b5a` |
| `gold-mint` | Gold · Mint | `#ffd000` | `#5affc1` |
| `custom` | user's own pair | — | — |

The shared `SettingsDrawer` renders exactly these five; the active slot is *derived* from
the stored pair via `matchAccentScheme(primary, secondary)` — nothing extra is persisted.
Add/retune a preset by editing `ACCENT_SCHEMES` only.

**Alpha rule:** fade a colour with `withAlpha(color, fraction)` from `@jkos/design` — bare
hex gets hex-concat, anything else (CSS vars!) gets `color-mix(… transparent)`. The old
`` `${color}66` `` pattern on a var produces invalid CSS the browser silently drops.
`pnpm check:cards` bans the raw pattern in `@jkos/cards` + `@jkos/ui`.

---

## 4. Wells & badges — the paper accent doctrine

Paper mode has exactly **two physical accent moves**:

- **The WELL** sinks *into* the sheet — an inner shadow (`--hub-accent-press`) that gives a
  region depth. Wells provide **boundaries**: contain, group, delimit. Class: `.jk-well`
  (accent-tinted 14% over card; retint any well/control with `--jk-tint: <colour>`).
- **The BADGE** sits *on* the sheet — a raised chip: top bevel highlight + drop shadow
  (`inset 0 1px 0 #fff@60%, 0 1px 0 accent@28%+line, 0 2px 5px rgba(48,34,20,.28)`).
  Badges are put on text and small marks; the badge is paper's **emphasis** — the exact
  analogue of dark mode's glow. Classes: `.jk-bubble-primary` (chip), `.jk-press` /
  `.jk-press-lg` (badged text: highlight above, accent-dark shade below).

**Primary accent takes the badge treatment; secondary stays flat** — one rung down, never
raised: `.jk-sub`, `.jk-sub-link`, `.jk-bubble-secondary` (tinted flat pill with a hairline
border). In CRT both moves flip to emissive automatically: the well's boundary becomes an
accent ring + glow, the badge's emphasis becomes halation — same classes, no forking.
Under Full Press the chips are **letterpress-cut**: `.jk-bubble` is serif caps (Fraunces
700) with the ink pressed into the chip on paper (a single lower-edge light catch) and
halation on the tube — the doctrine is unchanged, only the cut.

**The CHIP — the solid-ink item (suite default).** Where a bubble is a *pill/badge* and a
well is a *region*, a **chip** is a single tinted **item**: a calendar event, a task leaf,
a bench card. The default `.jk-chip.jk-chip-solid` is a saturated `--jk-tint` fill
(`color-mix(--jk-tint 82%, --accent-deepen-ink)`) with the type **cream-knocked-out and
pressed in** (`.jk-press-rev`); the faint raised base `.jk-chip` keeps neutral ink
(`.jk-press-ink`). State modifiers layer on: `-live` (now — brighter fill + ring), `-done`
(spent — flat, dimmed), `-sm` (dense). It mode-flips like every accent surface — inset
bevel + drop on paper, halation ring on the tube — and reads `--jk-tint` (unset → `--accent`)
so an item carries its own data hue. It **supersedes the calendar kit's old `ACCENT_GLAZE`
chip look** (that recipe retires as the kit adopts `.jk-chip` in Wave B). The pressed-type
family that titles chips — `.jk-press-ink` (neutral ink, shadow only), `.jk-press-rev`
(cream knockout on a solid tab), `.jk-press-sm` (small tinted press) — is the CUT applied
row-by-row, distinct from `.jk-press`'s raised primary badge. React: `<Chip>` +
`<Press variant="ink|rev|sm">` (`@jkos/ui`).

`.label-tape` is the badge made **physical** — an embossed metal strip for naming a panel.
Reach for it when the thing being named is *chrome* rather than *content*.

Glow (§8 of the live page) is the same doctrine on the dark face: `.jk-halo` /
`.jk-halo-text` (accent-locked) and `.jk-glow` / `.jk-glow-text` with `--jk-glow-color` +
intensity rungs `.jk-glow-low/-mid/-hi` (10px/20% · 16px/33% · 28px/52%). All collapse to
nothing on paper, so one class is correct in both faces. Emissive light is **scarce** —
the same one-LED rule as hardware.

---

## 5. Typography — the Voice (Full Press)

One doctrine, three speakers: **humans read print, the machine speaks mono, the tube
emits.** Full Press (Wave 22, 2026-07-19) promoted the serif from app copy into the
primitive layer — labels, text buttons, chips and stamps are now *printed*.

| Token | Face | Use |
|---|---|---|
| `--hub-font-serif` | **Fraunces** (suite default; Georgia fallback) | the print voice: headings, `.jk-lab`, `.jk-tbtn`, `.jk-bubble`, `.stamp`, `.jk-folio`, `.jk-colophon`, `.jk-async-note`, paper-face `.seg` |
| `--hub-font-mono` | **IBM Plex Mono** | the machine: data, annotation, tape text, `.mono-eyebrow`, `.jk-pill` |
| `--hub-font-sans` | **IBM Plex Sans** | body copy — quiet, legible, never the event; `.jk-lab-sans` |
| `--hub-font-seg` | **Big Shoulders Display** | phosphor numeric readouts (`.seg`, dark face) |

**Deliberately mono, untouched by the reface:** `.mono-eyebrow` and `.jk-pill` — machine
annotations and machine statuses keep the mono voice. `.jk-lab-sans` remains the blessed
softer (sans) eyebrow. The `.jk-lab` ladder is tracked Fraunces caps at
`calc(--hub-fs-lab* + 1px)` (the serif needs the extra point at these sizes).

**The seg verdict — `.seg` splits by medium.** The tube keeps Big Shoulders + glow
(dark face, unchanged); paper *prints* the readout — Fraunces lining tabular figures, no
glow (`:root:not([data-mode="dark"]) .seg`). One class, mode-correct.

**What each app actually loads** (Google Fonts, per `index.html` / jkAuth's `views.js`
layout): BeigeBoard, ORDECK, PapyrOS, KourOS and jkAuth all load Plex Mono + Plex Sans +
**Fraunces** (wght 400/600/**700** + italics — 700 is required by the chips/folio/stamps).
jkos-deploy's console deliberately loads Mono only — it is machine chrome end to end.
SylibOS loads Fraunces + Hanken Grotesk (off-limits). **Big Shoulders** is loaded only by
surfaces that actually render `.seg` — today that is the design page and **BeigeBoard**
(its masthead clock became the app's one `.seg` readout in the 2026-07-19 editorial pass);
if an app grows a phosphor readout, add the font to that app's `index.html`.

---

## 6. Geometry — corners, spacing, shell, breakpoints

**Corner radius — soft is the default, sharp is specified.** The hub scale is the Full
Press **print scale** (Wave 22 — a shade crisper than the old 10/6/8/11 cut; apps passing
their own `radius` are untouched). Any app that doesn't pass `radius` gets this:

```
--hub-radius: 8px    --hub-radius-xs: 4px    --hub-radius-sm: 6px   --hub-radius-lg: 10px
--hub-radius-soft: 10px   --hub-radius-widget: 8px   --hub-radius-button: 5px
```

Sharp is an opt-in, per app (a 0–2px scale through the factory `radius` input) or per card
(zero the `--hub-radius*` tokens on that element) — and it should stay uncommon. Never
hardcode a pixel radius; shapes read the tokens so a whole app retunes from one call.

**Shell dimensions:** `--hub-header-h: 52px` · `--hub-bus-h`/`--hub-footer-h: 28px` ·
`--hub-sidebar-w: 200px` (collapsed `40px`) · `--hub-rail-w: 56px` · `--hub-title-h: 34px`
· `--hub-widget-pad: 12px` · `--hub-grid: 40px` (the canvas-grid pitch).

**Breakpoints — one source, three tiers** (`packages/design/responsive/breakpoints.ts`):
mobile `0–767`, tablet `768–1023`, desktop `1024+`. `BREAKPOINT_MAX = { mobile: 767,
tablet: 1023 }` is the only literal; the `MEDIA` query strings and hub.css `@media` bounds
derive from it (gated by `pnpm check:responsive`). `useBreakpoint()` (`@jkos/ui`) returns
`'mobile' | 'tablet' | 'desktop'`.

**Responsive card scale** — components read these tokens, never literal px; the touch tiers
override only the inputs and derivation follows:

| Token | Desktop | Tablet ≤1023 | Mobile ≤767 |
|---|---|---|---|
| `--hub-tap-min` (tap floor) | `0px` | `44px` | `44px` |
| `--hub-widget-pad` | `12px` | `14px` | `14px` |
| `--hub-fs-bubble` / `-lg` | `9px` / `11px` | — | `11px` / `13px` |
| `--hub-pad-bubble` / `-lg` | `5px 11px` / `7px 14px` | — | `7px 13px` / `9px 16px` |
| `--hub-fs-pill` / `--hub-pad-pill` | `8px` / `4px 9px` | — | `10px` / `6px 11px` |
| `--hub-fs-tbtn` / `--hub-pad-tbtn` | `9px` / `6px 10px` | — | `11px` / `9px 13px` |
| `--hub-fs-lab` / `-sm` / `-xs` | `10/9/8px` | — | `11/10/9px` |

The tap floor applies only to **interactive** primitives (`button.jk-bubble`, `a.jk-bubble`,
`button.jk-pill`, `a.jk-pill`, `.jk-tbtn`) — `@jkos/ui` wrappers render interactive
instances as real `<button>`/`<a>` and static badges as `<span>`, so dense inline badges
stay dense.

**Media-grid density ladder:** `--hub-media-cols-compact/cozy/comfortable` = 2/3/4 columns,
gaps `0.85rem` / `0.75rem` (tight). Callers pick the density (usually from
`useBreakpoint()`); the grid never guesses.

---

## 7. Atmosphere — grain, CRT veils, scrims, canvas

- **Film grain** — a suite-wide backdrop texture, painted by the factory onto `<scope> body`
  and blended into the body's own background (`--grain-blend`: `multiply` paper / `screen`
  dark; noise alpha baked at ~0.495 paper / 0.135 dark). It textures the **backdrop only**
  — never content, cards or text; don't cover the body with an opaque fill. Opt a scope out
  with `grain: false`.
- **CRT knobs — owned by hub.css in both modes:** `--crt-scanline-opacity` (`0` paper /
  `0.012` dark), `--crt-vignette-opacity` (`0.08` paper / `0.45` dark), `--crt-scanline-ink`
  (`#000` paper / `#fff` dark — paper *scores* lines, dark *lifts* phosphor rows). The ONE
  sanctioned override: `@jkos/ui/tokens.css` flattens only the paper vignette to `0` for
  the full-shell apps. Never re-set a knob per app or bake an overlay opacity into a
  component — raise atmosphere through factory inputs.
- **Veils** (`.jk-scanlines`, `.jk-vignette`) are absolute overlays reading those knobs, so
  one markup is correct in both faces (they fall to nothing on paper). Host needs
  `position`.
- **Scrims:** `--hub-scrim` `rgba(10,8,6,.5)`, `--hub-scrim-heavy` `rgba(5,4,3,.85)` —
  warm-black in both modes (a scrim dims, it is not a themed surface). Classes `.jk-scrim`
  / `.jk-scrim-heavy`.
- **Canvas:** `.canvas-grid` — the workshop/boot ground (line-colour grid at `--hub-grid`
  pitch; opacity `0.5` paper / `1` dark via `--canvas-grid-opacity`); `.canvas-cell` — a
  bordered cell on it; `.perf` — perforation texture.

---

## 8. Shared class catalog (hub.css)

Everything here is demonstrated live on staging.jkos.net/design; `pnpm check:design` fails
if a class exists and isn't on the page. Reuse these — don't recreate them.

**Hardware (scarce punctuation):**
`.led` + `.green/.amber/.red/.cyan/.off/.steady/.sm/.lg` (8px pulsing dot; red pulses
faster) · `.label-tape` (embossed metal naming strip — **machine chrome only** under Full
Press) · `.stamp` (rotated rubber stamp, `currentColor`, serif — the printer's) · `.perf`
· `.canvas-grid` / `.canvas-cell` · `.seg` (phosphor numerals in dark; printed Fraunces
lining figures on paper — §5) · `.bar-track` / `.bar-fill` (amber-gradient meter).

**Print marks (Full Press — the press's own hardware, same scarcity rule):**
`.jk-rule` / `.jk-rule-strong` / `.jk-rule-double` — the rules ladder, an `<hr>` face
(hairline for rows/exhibits, ink for chapter heads, double for contents & colophon) ·
`.jk-folio` + `.jk-folio-no` — the folio mark that names **content** in print
(running-head rules, serif caps, accent-italic number; the counterpart of `.label-tape`,
which keeps naming machine panels) · `.jk-colophon` — the end-of-sheet record
(centre-set serif over an accent fleuron; halates in CRT).

**Accent system (§4):**
`.jk-well` (+ `--jk-tint`) · `.jk-bubble` base + `.jk-bubble-primary` /
`.jk-bubble-secondary` / `.jk-bubble-lg` · `.jk-press` / `.jk-press-lg` · `.jk-sub` /
`.jk-sub-link` · `.jk-sheet` (the card surface: bg-2, line border, card shadow + bevel).

**Chips — the solid-ink item (§4, suite default):**
`.jk-chip` (faint raised base, `--jk-tint`) + `.jk-chip-solid` (the loud saturated tab,
THE default) · state modifiers `.jk-chip-live` / `.jk-chip-done` / `.jk-chip-sm` · pressed
titles `.jk-press-ink` (neutral, shadow-only) / `.jk-press-rev` (cream knockout on a solid
tab) / `.jk-press-sm` (small tinted press). All `--jk-tint`-driven, mode-flipping; supersedes
`ACCENT_GLAZE`.

**Glow:** `.glow` / `.glow-dim` / `.glow-cyan` (phosphor text, accent families) ·
`.jk-halo` / `.jk-halo-text` · `.jk-glow` / `.jk-glow-text` + `.jk-glow-low/-mid/-hi` +
`--jk-glow-color`.

**Text system (the Voice, §5):** `.jk-lab` (+ `-sm`, `-xs` — tracked Fraunces caps;
`-sans` stays sans) · `.mono-eyebrow` (machine, mono, untouched) · `.jk-tbtn`
(+ `.jk-tbtn-quiet`; printed serif caps, hovers to the secondary accent) · `.jk-pill`
(green status pill — machine, stays mono) · `.jk-async-note` is set serif-italic (the
compositor's aside).

**Controls** — one rule across the set: a neutral debossed track that fills with the accent
(or `--jk-tint`) as it engages; each hosts on a real form/aria element so the platform
keeps the keyboard, and state styling keys off the aria attribute:
`.jk-switch` + `.jk-switch-knob` (46×26, `aria-checked`) · `.jk-check` (18px box) ·
`.jk-slider` (the house fader: real `<input type="range">`, milled metal cap on a filling
channel; the input box is `--hub-tap-min` tall while the track stays 6px; elapsed fill
paints from `--jk-slider-fill` — a percentage the caller sets, `<Slider>` does it for you;
never hand-roll a range with `accent-color`) · `.jk-vu` + `.jk-vu-seg.on` (segment meter).

**Veils:** `.jk-scanlines` · `.jk-vignette` · `.jk-scrim` / `.jk-scrim-heavy` (§7).

**Structural:**
- `.jk-shell` / `-header` / `-brand` / `-wordmark` / `-settings-btn` — the invariant app
  frame (auth guard → header → settings drawer). Deliberately neutral; the header carries
  no accent — the app's content is what gets lit.
- `.jk-media-grid[data-density="compact|cozy|comfortable"]` + `.jk-media-cover` /
  `.jk-media-cover-placeholder` — the cover grid + square art tile (placeholder reuses
  `.jk-well`).
- `.jk-async-note` / `.jk-async-error` — the loading/error/empty paragraph (error blends
  toward danger via color-mix, never raw red; set serif-italic under Full Press). Its old
  `.muted` alias was **retired** (Full Press Wave 26) — metadata lines carry dim ink on
  their own classes instead.
- `.jk-match-panel` / `-head` / `-search` / `-input` / `-candidate*` — the search →
  candidates → apply panel.
- `.jk-cards-row` / `.jk-cards-chip` / `.jk-cards-btn` — `@jkos/cards` hover/press
  affordances (kit-owned so the calendar renders identically in BeigeBoard tabs and ORDECK
  widgets).

**Global:** scrollbars (6px, line-strong thumb, accent-dim hover) and `::selection`
(accent-dim ground, bright ink) are styled once — don't restyle per app.

---

## 9. The player bar (`@jkos/player/ui`)

The one shared component stylesheet outside hub.css (`player-ui.css`, ships with the
package; the design page inlines it so §12 there is the real bar). `<PlayerBar>` is a
**slotted shell**, not a fixed control set — `meta · transport · scrubber · actions`
(+ `mobileTransport` / `mobileActions` overrides), three columns on desktop, stacked on
mobile. The control *set* stays the app's (PapyrOS stocks an audiobook vocabulary, KourOS a
music one) — only layout and chrome are shared. The bar is a **solid** surface with an
accent-tinted top rule (an earlier translucent+blur version dissolved into the page).
Seeking goes through the same `.jk-slider` as §8. Full Press weights `.pb-title` like a
title (Fraunces 600, −0.01em) — the bar's one serif line reads as one.

Class families: `.player-bar`, `.pb-left/center/right`, `.pb-meta`, `.pb-cover`
(+ `-empty`), `.pb-title` / `.pb-sub`, `.pb-transport`, `.pb-btn` (+ `-primary`, `-wide`,
`.is-armed`, `.pb-armed`, `.pb-count`), `.pb-scrubber` / `.pb-time` / `.pb-range-wrap` /
`.pb-scrub-ticks`/`-tick`, `.pb-queue` rows (`.pb-q-row` + `.is-current` /
`.is-drop-target` / `.is-dragging`, `.pb-q-handle/-item/-index/-title/-remove`),
`.pb-seglist` (`.pb-seg-row` + `.is-current`, `.pb-seg-fill` listened-width,
`-index/-title/-time`), `.pb-popover` (+ `-wide`, `-head`, `-row.is-active`, `-empty`),
`.pb-scrim`, `.pb-error`. React: `<PlayerBar>`, `<NowPlaying>`, `<Scrubber>`,
`<QueuePanel>`, `<SegmentList>`, `<Transport>`.

---

## 10. React & factory API

**`@jkos/design`** (framework-free):
- `buildJkOSTheme(config) → css` / `injectJkOSTheme(config, id?)` — the theme factory.
  Config (all optional; omitted keys inherit hub defaults):
  - `accent: { primary, secondary, deepenInk }` — pre-login defaults only
  - `light` / `dark`: neutrals with friendly keys mapping 1:1 onto tokens — `bg0..bg4`,
    `screen`, `screenLine`, `metal0..2`, `bevelLight/Dark`, `line/lineStrong/lineBright`,
    `cream/creamBright/creamDim/creamFaint`
  - `radius: { base, xs, sm, lg, soft, widget, button }`
  - `fonts: { mono, sans, seg, serif }`
  - `responsive: { tablet?, mobile? }` with `tapMin/widgetPad/fsBubble(...)/fsLab(...)` keys
  - `grain: false` to opt out · `selector` (default `:root`; e.g. `'html.od-v2'` scopes a
    subtree while derivation on `:root` still reads the inputs)
- `applyJkOSMode('system'|'light'|'dark') → isDark` — stamps `data-mode`, persists to
  `localStorage[STORAGE_KEYS.mode]` (`'jkos-mode'`) for the pre-hydration bootstrap.
- `applyJkOSTheme({ primary, secondary })` — writes the raw pair; CSS does the rest.
- `withAlpha(color, fraction)` (§3) · `ACCENT_SCHEMES` / `CUSTOM_SCHEME_ID` /
  `matchAccentScheme` · `BREAKPOINTS` / `BREAKPOINT_MAX` / `MEDIA` / `activeBreakpoint` ·
  `MEDIA_GRID_COLUMNS` · `STORAGE_KEYS`.

**`@jkos/ui`** (React; polymorphic `as` prop on the text/accent primitives):
- Accent/text: `<Bubble tone="primary|secondary" large>`, `<Press large>`, `<Sub>`,
  `<SubLink>`, `<Well tint>`, `<Sheet>`, `<Lab size="sm|xs" sans>`, `<TButton quiet>`,
  `<Pill>`, plus `cx(...)` classname join.
- Controls: `<Switch checked onChange tint>`, `<Check checked onChange tint>`,
  `<Slider value min max step onChange onCommit tint>` (`onChange` per move, `onCommit` on
  release — the split a seek control needs), `<VU value segments tint>`.
- Veils: `<Scanlines>`, `<Vignette>`, `<Scrim heavy>`.
- Structural: `<AppShell>` (guard → header → `SettingsDrawer` → preferences wiring; brand,
  wordmark, settings button), `<MediaGrid density>`, `<CoverArt src alt>` (falsy `src` →
  immediate fallback tile), `<MatchPanel>`, `<AsyncView loading error empty>`,
  `<WidgetShell>` (ORDECK widget frame), `<JkOSTheme config>` (declarative
  `injectJkOSTheme`), `<SettingsDrawer>` (THE settings tray — every app mounts it; extras
  go in its `extra` slot; its AI section is gated on the jkAuth `lazuros.enabled` kill
  switch).
- Hooks: `useBreakpoint()`, `usePointerDrag` (the one drag gesture primitive —
  immediate/distance/hold activation, capture + click-suppress; 4px threshold so taps
  select and drags move).

**Mode/theme flow at runtime:** app boots → pre-hydration script reads
`localStorage['jkos-mode']` and stamps `data-mode` (no flash) → auth loads the user's flat
theme → `applyTheme` (`@jkos/auth-client`) calls `applyJkOSMode` + `applyJkOSTheme` →
`SettingsDrawer` edits write back via `PATCH /auth/profile`.

---

## 11. Per-app profiles

| App | Stack | Serif | Factory config (actual) | Notes |
|---|---|---|---|---|
| **BeigeBoard** (planner) | React 18, plain CSS (`src/app.css`) | Fraunces | `radius: { base 8, xs 4, sm 7, lg 11, soft 9, widget 10, button 8 }` | **Full Press rebuild (2026-07-20)** — a view-layer redesign onto the new solid-ink chip system (the editorial pass 2026-07-19 was its masthead/rules groundwork; the folio retired for bordered `.jk-lab` week/date chips). **Today** = kit `DayView` single-day timeline + a 388px right rail (`.jk-sheet` bench + goals-in-press rollups + `.jk-colophon`); **Week/Calendar** = the reskinned kit views unchanged at the app level (the kit now owns the chrome — seven framed gapped day-lanes, today = tinted `jk-well` + `jk-press`); **Workshop** = a two-pane forge (goal rail, `jk-well` when selected → header `jk-press-lg` + `jk-rule` + expand/collapse milestone→leaf tree, each leaf a `.jk-chip` + `.jk-check`), retiring the drill-down + weekly bench + carried/adrift/next planning intel; **header** = pressed serif wordmark + `.jk-lab` chips + **mono** nav (active = `jk-well` + `jk-press`) + `.seg` clock. Motion on the `data-motion` axis (`.mo-item` rows, ambient rake/buzz opt-in; intro presses on paper). DetailPanel kept + restyled as the edit surface. Desktop only — `src/mobile/*` untouched behind `useBreakpoint()`; drag via `usePointerDrag` |
| **ORDECK** (HUD/portal) | React 18, plain CSS | Fraunces | `selector: 'html.od-v2'`, `radius: { base 10, xs 4, sm 7, lg 16, soft 8, button 9 }` | v2 HUD scopes its theme to `html.od-v2`; widget system + workshop; login page is minimal hardware (LED + glow title) |
| **PapyrOS** (audiobooks) | React 18, plain CSS | Fraunces | `accent: { #9a4b2c, #5c8a72 }`, `radius: { base 6, xs 3, sm 5, lg 10, soft 7, button 6 }` | First `@jkos/player` consumer; offline cache + SW media |
| **KourOS** (music) | React 18, plain CSS | Fraunces (suite default) | `accent: { #4b3f8f, #dba13c }`, `radius: { base 5, xs 3, sm 4, lg 8, soft 6, button 5 }` | Second player consumer — deliberately different shape; loads Fraunces since Full Press (the primitives are printed) |
| **jkAuth** (login/portal) + **jkos-deploy** (console) | static HTML/JS | — | none (hub defaults) | Render a generated **mirror** of hub.css (`jkos-tokens.css`) — regen commands in §14 |
| **SylibOS** (reading) | React 19, **Tailwind v4 CSS-first** | Fraunces (+ Hanken Grotesk sans) | `@theme` block in `src/index.css`; no `tailwind.config.js` | `dark:` variant keyed to `[data-mode="dark"]`; Tailwind colour utilities remapped onto `var(--hub-*)`. **Off-limits for edits** (owner's standing rule) — described here for coherence only |

Observations a design pass should know: no app currently passes custom **neutrals** — every
app runs the two hub palettes and differentiates via accent defaults, radius scale and the
serif voice. That is a deliberate open lever (§15). All apps mount the same `SettingsDrawer`
and `AppShell`; there are no per-app settings panels or shells.

---

## 12. Motion vocabulary

Utilities (hub.css, one copy — app sheets keep only bespoke frames like BeigeBoard's
`paperExpand`, ORDECK's `reel-spin`/`ticker-scroll`):

| Class | Keyframe | Duration/fill | Feel |
|---|---|---|---|
| `.view-enter` | fadeSlideUp | 0.32s, no fill | view mounts: rise 10px + fade |
| `.panel-enter` | panelIn | 0.34s, no fill | side panel: slide 28px from right |
| `.item-in` | itemIn | 0.26s both | list item: drop 4px + fade |
| `.modal-in` | modalIn | 0.22s both | dialog: scale .96 → 1 |
| `.boot-sweep` | bootIn | 0.4s, no fill | boot cell: fade + left-to-right clip reveal |
| `.crt-expand` | crtExpand | 0.55s both | CRT power-on: line collapse + brightness flutter |
| `.intro-title` / `.intro-out` | introTitleReveal / introFadeOut | 0.7s both / 0.45s forwards | boot title in / boot screen out |
| `.now-dot` | pulseOpacity | 1.8s infinite | "live now" marker |
| `.check-pop` | checkBounce | 0.25s | check confirmation pop |
| `.ink-in` (Full Press) | inkDry / crtExpand | 0.44s / 0.5s, no fill | **the face-aware entrance**: ink dries on paper; the tube powers on in dark — same class, opposite physics. Apply at view/panel/item boundaries once; never stack on another entrance |
| `.mo-item` (Full Press) | inkDry / crtOn | 0.5s / 0.62s **both** | the `.ink-in` physics applied **row-by-row**, staggered via inline `animation-delay`. Carries `both` so a row sits hidden until its delay fires — so ONLY on elements that don't host a `position: fixed` popup (fill-mode caveat below). Gated by `data-motion` |
| `.jk-rake` (Full Press) | rakeSweep | 26s infinite | ambient raking light across the **paper** sheet — gated `<html data-motion="full">`, off otherwise |
| `.jk-buzz` (Full Press) | crtBuzz | 4.3s infinite | ambient phosphor glow breathing in the **tube** — the CRT companion to the rake, same `data-motion="full"` gate, dark face only |

**The `data-motion` axis** (Full Press) — a runtime attribute on `<html>`, the motion sibling
of `data-mode`, written by `applyJkOSMotion()` (`@jkos/design`): `full` (entrances + ambient
rake/buzz) · `entrance` (entrances only, ambient quiet) · `static` (nothing moves). **Absent
behaves as `entrance`** (entrances fire, ambient off — the sensible default), so an app opts
*into* atmosphere with `full`. `'system'` resolves to `static` under `prefers-reduced-motion`.
It folded the old `data-ambient="on"` rake gate onto one axis.

Ambient keyframes: `led-pulse` (2.4s, on every `.led`), `blink`, `data-flicker` (rare
4s-cycle dip), `grain`, `spin`, `scanRoll`, `scanPulse`, `artifactFlash`.

Rules: ambient effects are subtle and **opacity-only**; entrances land in **200–400ms**.
`prefers-reduced-motion` is now honoured **once in hub.css** for the shared entrances and
ambient loops (entrances snap to their final frame; LED pulse / now-dot / rake / buzz stop) —
app sheets still guard their own bespoke frames. **Fill-mode gotcha:**
`.view-enter`/`.panel-enter`/`.boot-sweep` carry no fill-mode on purpose — a retained
`transform`/`clip-path` makes the element a containing block for `position: fixed`
descendants (Chromium keeps treating it as such while the animation is "in effect"), so
keyframes end at the resting style and revert. Keep that property when adding entrances.

---

## 13. Invariants — the fence

Do not cross these in any design pass:

1. **Token names are frozen** — never rename a `--hub-*` / `--color-*` token; every
   consumer references them.
2. **The mode contract** — `data-mode` ∈ {`"paper"`, `"dark"`} on `<html>`; no
   `prefers-color-scheme` in components.
3. **Accents are universal and user-driven** — never hardcode `--accent` or a hex in a
   component; per-app identity is expressed only through **accent defaults / neutrals /
   radius / fonts** passed to the factory. The derivation is written once in hub.css —
   never restate it.
4. **Both faces, any accent** — every screen must hold up in paper and dark under all five
   accent slots.
5. **API freezes** — signatures of `applyJkOSMode` / `applyJkOSTheme` / `applyTheme` /
   `normaliseTheme`; the flat theme shape `{ mode, primary, secondary }`; the friendly-key
   maps in `buildJkOSTheme`.
6. **One of each** — one settings tray (`SettingsDrawer`), one accent chooser (five slots),
   one shell (`AppShell`), one drag primitive (`usePointerDrag`), one async triad
   (`AsyncView`). No per-app copies.
7. **No icon library** — inline SVG + hardware classes.
8. **Hardware & glow are scarce** — punctuation, not wallpaper.
9. **CRT knobs are hub-owned** — the `@jkos/ui` paper-vignette flatten is the only
   sanctioned override.
10. **`withAlpha()` for fades** — never hex-concat on a var.
11. **SylibOS is not edited** — describe-only in this doc.
12. **The Voice holds (Full Press):** content is named in **print** (`.jk-folio`);
    `.label-tape` is for **machine** chrome only. The machine speaks mono — never re-face
    `.mono-eyebrow` or `.jk-pill` into the serif, and never take Big Shoulders off the
    dark-face `.seg`. Off-state copy follows the print idiom ("Setting type…", a stamped
    NO SIGNAL), not generic spinner prose.

---

## 14. Working agreement — how a design pass ships

**Files a design pass touches:**

| What | Where |
|---|---|
| Tokens + shared classes | `packages/design/tokens/hub.css` (inputs *and* the one derivation) |
| Factory / schemes / breakpoints | `packages/design/theme/*.ts`, `packages/design/responsive/*.ts` |
| React primitives | `packages/ui/src/*.tsx` (+ `packages/player/src/ui/*` for the bar) |
| Per-app styling | `apps/<app>/src/app.css` + the app's `injectJkOSTheme` call |
| The reference page | `apps/jkauth/scripts/design-template.html` (gallery layout is namespaced `.dg-*` and may not restyle a system class) |
| This document | `Documentation/DESIGN.md` — update the value tables if you change hub.css |

**After ANY hub.css change, regenerate all three derived artifacts** (they are committed):

```bash
pnpm --filter @jkos/jkauth sync:tokens        # jkAuth static mirror
node jkos-deploy/scripts/sync-tokens.mjs      # jkos-deploy static mirror
node apps/jkauth/scripts/build-design-page.mjs  # staging.jkos.net/design snapshot
```

**Gates** (all folded into `pnpm test:contracts`; run the focused ones while iterating):
`pnpm check:tokens` (mirrors + alias resolution + derivation parity) · `pnpm check:design`
(page fresh + every hub class demoed) · `pnpm check:responsive` (breakpoint single-source +
tap floor) · `pnpm check:cards` (kit purity, `withAlpha` ban) · `pnpm check:async-view`.

**Verification:** open the design page (or the app) in **both faces**, cycle the accent
slots, and check the three breakpoint tiers. The repo path contains a space — quote it in
shell commands. Branch is `staging`; the live page updates after the jkAuth image rebuilds.

---

## 15. Brief for Claude Design — elevate inside the fence

> **SPENT (2026-07-19).** This brief was answered by **Full Press** — the Rollout Dossier
> (ToDo.md §7, Waves 22–26) is its successor and the plan of record. The "known
> opportunities" below are resolved by it: the seg face (opportunity 2) became the seg
> verdict (§5), off-states (3) carry the print idiom, login surfaces (5) land in the
> per-app wave. Treat §1–§14 as live context and this section as historical.

*This section was the prompt. Everything above is your context; the live page
https://staging.jkos.net/design is your eyes. You need no other repo source — but the code
always wins over this doc if they disagree.*

**Mission.** Elevate the overall aesthetic of jkOS — composition, hierarchy, spacing,
atmosphere, craft — while staying entirely inside the fence (§13). The owner is a systems
builder, not a visual designer: your judgment on *taste* is why you're here. The identity
(§1) is settled and loved; the request is to make it **more itself**, never to normalise it
toward flat modern UI.

**How to work.**
- Think in the system's own physics: paper = wells (boundary) and badges (emphasis);
  dark = emissive glow. If a new element needs emphasis, it takes the badge/glow treatment;
  if it needs containment, a well — not a new shadow style.
- Prefer moving *values through existing seams* (tokens, factory inputs, class refinements)
  over new CSS surface. If a genuinely new primitive is warranted, add it in hub.css +
  `@jkos/ui`, demo it on the design page (the gate forces this), and document it here.
- Ship changes the way §14 describes; keep both faces and all five accent slots beautiful —
  the amber·cyan default is the face of the system, but ice·coral is the stress test.
- Respect scarcity budgets: per screen, roughly one LED, one tape strip, one glowing
  element cluster. Emphasis spent everywhere is emphasis lost.

**Known opportunities (a starting map, not a limit):**
1. **Per-app neutral palettes.** Every app currently runs the two hub palettes (§11) —
   the factory's `light`/`dark` neutrals input is an untouched lever for giving each app a
   distinct paper stock / phosphor tint while keeping one identity.
2. **The seg face.** Big Shoulders Display isn't loaded by any app, so 7-seg readouts fall
   back to Plex Sans — decide per app: load it where readouts matter, or stop pretending.
3. **Off-states.** Loading/empty/error (`AsyncView`) are functionally unified but visually
   plain — they could carry the hardware idiom (a dim LED, a stamped NO SIGNAL) without
   new primitives.
4. **The design page's own deck badge** (`jkOS // DESIGN` label-tape) is a placeholder the
   owner wants redesigned — a small, high-visibility canvas.
5. **Login surfaces** (jkAuth portal, ORDECK login) predate the wells/badges doctrine and
   could be brought onto it.
6. **Atmosphere tuning.** The CRT knobs and grain alphas (§7) have never had a deliberate
   design pass — small value moves, big mood shifts. Change them in hub.css only.

**Deliverables.** Concrete diffs (or precise value/class proposals) + updated value tables
in this doc + regenerated artifacts + green gates — with a short rationale per change
written in the system's vocabulary (which face, which accent move, what got scarcer).
