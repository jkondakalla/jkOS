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

**The canvas — one measure per page.** A full-page view's **outermost** element is the
canvas, and *everything lives inside it, rails included*. Panes never re-centre themselves:
the page owns the measure, a component fills what it is given. This replaced four
disagreeing rules in BeigeBoard alone — Week capped at 1280, Today capped its timeline at
760 *inside a pane* while its rail stayed welded to the window edge, Calendar and Workshop
ran full bleed. On a 2560px monitor that read as content adrift left of centre beside a
marooned rail, 350px month cells, and 2200px-long forge rows. It is also why the
`@jkos/cards` views carry **no `max-width` of their own**: in an ORDECK widget they fill the
widget, on a page they fill the page.

Width is **fluid with a cap** — the smallest of three terms:

```
--jk-canvas: min(100% - 2*--jk-canvas-gutter,  --jk-canvas-base + --jk-canvas-rise,  --jk-canvas-cap)
             ↑ window minus gutters            ↑ 900px + 34vw                        ↑ 1760px
```

Below ~1440px the first term wins and the canvas simply fills; above it it grows at about a
third the rate the window does, so the margins open progressively rather than all at once,
and stop at the cap. Roughly **964 @1024 · 1380 @1440 · 1545 @1920 · 1760 @2560+**.
Mobile needs no second implementation — term 1 wins outright and the gutter drops to `0`.

| Class | Does |
|---|---|
| `.jk-canvas` | the measure: centre at the house width. Override per view with `--jk-canvas-w` |
| `.jk-canvas-fill` | + fill a flex parent as a column (a full-height app page) |
| `.jk-canvas-foot` | the optional bottom anchor: `margin-top:auto` + a tapered ink rule. A `.jk-colophon` inside sets on one line. BeigeBoard renders none — see "Vertical" below |

**Rails** are one width, `--jk-rail: 360px` (`--jk-rail-sm: 260px`; `300px` on tablet, `100%`
on mobile where a rail stacks). A rail is a pane *inside* the canvas — never a sibling of
the window.

**Vertical:** views **top-set** like a printed page. `.jk-canvas-foot` is the optional
bottom anchor — a rule plus a colophon that makes a short view on a tall monitor read as
measured margin rather than as trailing off into dead ground. The kit's page views take the
words via a `foot` prop (ignored at `compact` density — a HUD widget has no foot); the app
supplies the voice.

**BeigeBoard now passes no `foot` at all (2026-07-30, Jag's call).** As a page footer that
line "only distracts": it pulls the eye down *below* the thing the view exists to show, and
its rule makes a second page boundary arguing with the masthead's inlay. The margin it was
spending is still needed — content running to the last pixel of the window reads as clipped
— so the canvas keeps it directly (`paddingBottom: 18`) and the page simply ends in air, no
divide. The primitive and the `foot` seam stay: the colophon is worth re-siting, not
deleting.

**A measure, not a card — the canvas draws NOTHING.** The page ground is the app's own
grained background (`buildJkOSTheme` paints `--hub-grain-image` onto `body`), and content
sits **directly on it**; the canvas only decides how wide that content runs. It was briefly
drawn as a lifted sheet of paper stock on a darker desk (`.jk-canvas-sheet`, `--jk-desk`,
`--jk-sheet-lift`) — that read as a document floating in a window rather than as the app's
own ground, so all three are **deleted**. Two consequences worth stating: the shell must
stay transparent all the way down to `body` or the texture is lost, and anything that
should read as a raised card uses `.jk-sheet` — at card scale, never page scale.

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
`.jk-rule` / `.jk-rule-strong` / `.jk-rule-double` / `.jk-rule-taper` — the rules ladder,
an `<hr>` face (hairline for rows/exhibits, ink for chapter heads, double for contents &
colophon). The fourth weight is **the inlay**, and it is the one divider in the suite that
is not ink. *Geometry* earns it the slot: a square cut is right *inside* something that
already has an edge, but at the boundaries of the canvas there is no edge, so a square-cut
rule terminates in mid-air and the page reads as **cropped**. The inlay feathers out over
the last ~9% at each end. Being the only line that ends in **points**, it is also the only
one with a silhouette of its own — so it gets a *material*: hammered steel let into the
sheet on paper (groove shadow → crown catch-light → lit face → shaded face and lip → the
sheet's catch), and the same blade **lit** on the tube, silver rather than cream because
this is metal and not type. Spend it on the masthead's edge and nowhere else — scarcity is
what makes it read; `.jk-canvas-foot` borrows the geometry and stays ink. Inside a bordered
container keep `.jk-rule` — an inlay there is furniture.
Two implementation facts are load-bearing, both learned the hard way.
**(1)** The face is authored **one band per device pixel** (5px bead, whole-pixel stops).
Drawn first at 4px with sub-pixel stops, Chromium averaged each pair into one row: the
groove shadow cancelled the crown, the sheet's catch cancelled the lip, and the bullnose
rendered as a flat line. A bevel this small must be authored at the resolution it will be
rasterised at.
**(2)** The dark face's glow is a **background layer inside a 15px box**, not a
`filter: drop-shadow()`. Chromium applies `mask` to the *filtered* output and clips it to
the border box — `mask-clip: no-clip` does not lift it — so a drop-shadow comes out sliced
flush, giving square ends to the one element whose entire identity is that it has points.
Drawn inside the masked box, the same taper that shapes the bead shapes its light.
Seams: `--jk-inlay-mask` / `--jk-inlay-face` (`.jk-masthead::after` renders the same object
from the same recipe, so the two cannot drift). ·
`.jk-folio` + `.jk-folio-no` — the folio mark that names **content** in print
(running-head rules, serif caps, accent-italic number; the counterpart of `.label-tape`,
which keeps naming machine panels) · `.jk-colophon` — the end-of-sheet record
(centre-set serif over an accent fleuron; halates in CRT).

**Accent system (§4):**
`.jk-well` (+ `--jk-tint`) · `.jk-bubble` base + `.jk-bubble-primary` /
`.jk-bubble-secondary` / `.jk-bubble-lg` · `.jk-press` / `.jk-press-lg` · `.jk-sub` /
`.jk-sub-link` · `.jk-sheet` (the card surface: bg-2, line border, card shadow + bevel).

**The canvas — page measure (§6):**
`.jk-canvas` (centre at `--jk-canvas`; override with `--jk-canvas-w`) · `.jk-canvas-fill`
(fill a flex parent as a column) · `.jk-canvas-foot` (optional bottom anchor:
`margin-top:auto` + a **tapered ink** rule — the taper's geometry, deliberately not its
metal; a `.jk-colophon` inside sets on one line). Rails: `--jk-rail`. The canvas
paints no surface of its own — the grained `body` is the ground (`.jk-canvas-sheet` /
`.jk-desk` are gone).

**The masthead — the canvas's head:**
`.jk-masthead` · `.jk-masthead-tab`. A page's top bar is **set as a masthead, not built as
a toolbar**: no fill and no border, so the ground's grain runs unbroken from the first pixel,
and the bottom edge is **the inlay** (§ print marks) — one tapered metal bead, drawn from
the same `--jk-inlay-*` recipe as `.jk-rule-taper`. It replaced an opaque `--color-paper` bar
with a square `border-bottom`, which was a **slab**: its fill was the one region where the
grain stopped, and because the canvas is a measure floating on the ground, that rectangle's
left, right and bottom edges were square cuts in mid-air — the same "document floating in a
window" reading the drawn-sheet motif was deleted for. It was then briefly an ink *ladder*
(a rule with a hairline hung under it); one bead replaced both, because a second line under a
piece of metal reads as two pieces of trim.
Transparency is only safe because a canvas app-shell never scrolls content *under* its head
(each view scrolls inside its own `.jk-scroll`); a masthead over a scrolling document needs
its own fill.
Nav in a masthead is **boxed**: `.jk-masthead-tab` for the reset and the hover fill, plus
`.jk-well` on the current tab. It spent one pass as a fill-less *thumb-index* (marked by
weight and a stub of accent rule on the ladder) and came back, which is the instructive part
— **a filled box states the face instantly, because the fill IS the face**: a tint debossed
into the sheet on paper, an emissive ring and glow on the tube, both inherited from
`--hub-accent-press` rather than restated. A weight change and a 2px stub state neither, and
the nav is the first thing looked at, so it is where the mode has to be legible.
Both of the tab's own background rules are guarded on `:not([aria-selected="true"])`, and the
guard is load-bearing: the block is declared *after* `.jk-well` (it must be, to bring the
radius down to tab scale), so at equal specificity an unguarded `background: transparent`
silently blanks the current tab's tint and leaves a well with no fill.

**The detail panel — an overlay ON the canvas, never a member of it:**
`.jk-panel` + `.jk-panel-rail` / `.jk-panel-sheet` › `.jk-panel-head`. The pane that slides
in over a page to show one selected thing. `position: absolute` here is **load-bearing, not
styling**, and the reason is a bug that shipped twice:

1. It took a fill-moded transform entrance; a transform "in effect" makes an element a
   containing block, so `position: fixed` popups it hosted mispositioned. (Fixed by the
   no-fill-mode rule on `.view-enter` / `.panel-enter` — §12.)
2. It was the app shell grid's only **definitely**-placed child (`grid-row: 2; grid-column: 1`,
   sharing the content cell with `<main>`). Grid places definite items before auto ones, so
   the panel claimed the cell first, auto-placement found it taken and pushed `<main>` into an
   **implicit row 3**, and the declared `minmax(0, 1fr)` row collapsed to **0px**. The panel
   mounted, rendered its entire subtree, measured zero, and was invisible — "open a task" did
   nothing, in every view at once.

Both are one mistake: *an overlay that participates in layout*. The rule that follows:
**place every child of an app-shell grid explicitly** (auto-placement is order-dependent on
which siblings happen to be mounted), and give the overlay a positioned,
`pointer-events: none` host spanning the region it covers — never `grid-row`, `grid-column`,
`align-self` or `justify-self`. `.jk-panel-head` is the selected item's own flag: a solid
`--jk-tint` band, so it reads as the loudest member of the chip family (§4) rather than as a
coloured toolbar, and it takes the same CRT face flip `.jk-chip-solid` does (a saturated fill
on the tube is a light source, not ink — the band drops to the phosphor base and the title
goes emissive). Width: `--jk-panel-w`. Held by `pnpm check:overlay`.

**Chips — the solid-ink item (§4, suite default):**
`.jk-chip` (faint raised base, `--jk-tint`) + `.jk-chip-solid` (the loud saturated tab,
THE default) · state modifiers `.jk-chip-live` / `.jk-chip-spent` / `.jk-chip-done` /
`.jk-chip-sm` · pressed titles `.jk-press-ink` (neutral, shadow-only) / `.jk-press-rev`
(cream knockout on a solid tab) / `.jk-press-sm` (small tinted press). All
`--jk-tint`-driven, mode-flipping; supersedes `ACCENT_GLAZE`.

`.jk-chip-spent` is **ended, but nobody struck it off** — deliberately only an `opacity: .68`,
so a spent chip keeps its fill, ring and type and loses only its weight. It is what makes a
now-line read as a position in the day rather than a line drawn across it. **The states are
not a per-call-site choice:** `chipState(item, now)` in `@jkos/cards` decides, so an item
carries the same weight in every view that renders it.

**Glow:** `.glow` / `.glow-dim` / `.glow-cyan` (phosphor text, accent families) ·
`.jk-halo` / `.jk-halo-text` · `.jk-glow` / `.jk-glow-text` + `.jk-glow-low/-mid/-hi` +
`--jk-glow-color`.

**Text system (the Voice, §5):** `.jk-lab` (+ `-sm`, `-xs` — tracked Fraunces caps;
`-sans` stays sans) · `.mono-eyebrow` (machine, mono, untouched) · `.jk-tbtn`
(+ `.jk-tbtn-quiet`; printed serif caps, hovers to the secondary accent) · `.jk-pill`
(green status pill — machine, stays mono) · `.jk-async-note` is set serif-italic (the
compositor's aside).

**Fields — the WRITE half of the control set (2026-08-17):**
`.jk-field` (input/select/textarea) + `.jk-field-sm` (the dense-editor rung) +
`.jk-field-title` (the display-serif name field) · `.jk-field-sel` (select wrapper, drawn
caret) · `.jk-field-num` + `.jk-field-step` (number wrapper + the house stepper) ·
`.jk-field-bare` (the reset **without** the slot) · `.jk-field-check` (a real
`input[type=checkbox]`, for server-rendered forms `<Check>` can't reach) · `.jk-fold`
(`<details>`, house caret for the OS triangle) · `.jk-scroll-none` (a strip that scrolls
and shows no bar).
React: `<Field>` (`display` for the serif rung — **not** `title`, which is a real HTML
attribute these fields carry tooltips in; `bare` for the no-slot variant), `<NumField>`,
`<SelectField>`, `<TextArea>`, `<DateField>`, `<TimeField>`, `<SearchField>`, `<Fold>`.
All of them forward refs.

**`bare` is the escape hatch that keeps the rule absolute.** Some edits are not slots —
renaming a panel title happens *in* the title, on the accent band; "done means" is an
underlined phrase in running text. A debossed tan box there puts a control where a piece
of writing is. `.jk-field-bare` takes the face off and keeps the whole reset, so **every**
input in the suite carries a `jk-field` class and the ones that must look like nothing say
so. `pnpm check:fields` enforces exactly that, with one exemption — `type="hidden"`,
matched on the tag rather than the file, because it renders nothing to take paint away
from.

Until this existed the suite had **no input primitive at all** — five app-local `field`
style objects, and not one of them reset `appearance`. Under a hand-drawn hairline the
browser kept painting its own chrome: white spin buttons on every number, an OS arrow on
every select, autofill yellow, the search ×. On warm paper or an amber tube those blank
white boxes are not a blemish, they are a different design system showing through. The
class kills all of it (each vendor pseudo in its **own** rule — one selector an engine
doesn't know drops the whole thing, same trap as `.jk-slider`'s track/thumb pairs).

**The recess is a token pair, not a shared shadow** — `--hub-field-face` /
`--hub-field-recess` (+ their `-focus` twins), overridden wholesale in the dark block:
paper debosses (shadow off the top lip, light caught at the bottom, rim takes the accent
on focus); the tube drops to unlit `--hub-screen` with an inner falloff, **no bevel at
all** — there is no raking light on a CRT to catch — and then *emits* on focus. Re-tinting
the paper bevel for dark is exactly what makes a dark field read as a light field with the
colours swapped. The two faces also need different *amounts*: paper's focus has to carry
the whole state on depth and rim, so its numbers run harder than a dark-mode eye expects.
`:disabled` drops the recess entirely — a slot you cannot write in must stop looking like
one. Mobile forces `--hub-fs-field` to 16px: below that iOS Safari zooms the viewport on
focus, and a form that jumps the page on every tap is broken.

The stepper is **ink only** — stacked border-triangle carets on a hairline divider, ghosted
at rest, full ink on hover/focus of the group — driving the input's own
`stepUp()`/`stepDown()` so min/max/step behave as the native chrome did. `<NumField>`
re-dispatches through the prototype value setter, because React tracks the last value it
wrote on the node and would otherwise swallow the event as a no-op.

**`color-scheme` is the only lever over the engine's own popups (2026-08-17).** Everything
else in `hub.css` dresses *our* markup. A select's dropdown list, the calendar a date field
opens, the autofill menu and the caret are OS windows no selector reaches — and without
`color-scheme` on `:root` they all come back white on the tube however dark the page around
them is. It lived in `app.css` and `ds-ground.css` and **nowhere else**, so ORDECK and
jkAuth never had it at all; it now sits with the tokens it flips beside. `accent-color` is
its smaller sibling — any native control we haven't drawn lands amber, not Chrome blue.

**Date and time fields are not one box.** The engine builds a widget of segment spans
inside them, each painting itself, and the segment under the caret fills with the system
*highlight* colour. Every segment is addressed in `hub.css` and the highlight is replaced
with the accent wash `::selection` uses. Each segment gets its own rule for the usual
reason.

**The dropdown is drawn, in CSS, with no listbox component.** `appearance: base-select`
moves the picker into the page's top layer as real styleable content —
`::picker(select)` is the popup, `::picker-icon` the caret, `option::checkmark` the
selected mark — while the element stays a plain `<select>`, so the keyboard, screen
readers, form association and the mobile picker are all still the platform's. It is inside
`@supports` because it's Chromium-only for now; engines without it fall back to the
`appearance: none` button, the wrapper's drawn caret and a native list that `color-scheme`
keeps face-correct. **Clear `::picker-icon`'s `content`** or the house chevron draws on top
of the OS glyph and you get two overlapping arrows. The popup reads as the MENU surface
(`--hub-menu-*`, a two-face pair like the recess): raised with a drop shadow on paper,
accent-rimmed and blooming on the tube, which can't cast a shadow onto phosphor.

**Scrollbars: the two syntaxes are mutually exclusive in Blink.** The obvious way to cover
both engines — set `scrollbar-width`/`scrollbar-color` *and* the `::-webkit-scrollbar-*`
parts — silently loses the drawn one: the moment `scrollbar-color` applies, Chrome discards
every webkit pseudo for that element and paints its own themed bar, **with stepper arrows
at both ends that nothing can remove**. So the standard properties go behind
`@supports not (selector(::-webkit-scrollbar))`, handed only to engines with no pseudos to
lose.

**The scroll bar is a hairline, not a gutter.** It was a drawn channel-and-pill for exactly
one pass: the reasoning was that a gutter should be a real object like a meter's trough, and
in use the trough was the loudest thing on a quiet page — a solid recessed strip running the
full height of every pane, competing with the content it was only there to index. It is now
**2px of ink laid on the stock**: no track, no channel, no corner square, no arrows. The mark
says the same two facts (how far down, how much there is) with a rule instead of a rail.

**Three rungs, and the resting one never goes to zero.** `--hub-scroll-mark-rest` is always
painted, because a bar that is invisible until you touch it hides the one piece of information
a scrollbar exists to give. `--hub-scroll-mark` deepens it while the pointer is inside the pane
*or* the pane is moving; `--hub-scroll-mark-hover` brightens it with the pointer on the mark
itself; a drag goes full `--accent`. Two-face as always, and the faces are not a re-tint: on
paper the mark mixes `--accent-deepen-ink`, so it reads as a pencil rule on the sheet; on the
tube it mixes the raw `--accent`, because a neutral 2px mark at these opacities simply
disappears against unlit stock — which is how the *first* ghost-thumb attempt failed. Set
`--hub-scroll-mark-rest: transparent` for the fully-hidden face; nothing else changes.

**`[data-scrolling]` is the rung CSS cannot reach.** `:hover` is wrong about a pane that is
moving with no pointer over it, which is most scrolling that actually happens — a wheel fling
that carries past the pane, trackpad momentum, PageDown, `scrollIntoView` from a deep link, all
of touch. `installScrollHairline()` (`@jkos/design`) stamps `data-scrolling` from **one
capture-phase `scroll` listener** on the document and drops it 850ms after motion stops;
`scroll` does not bubble, so capture is the only phase where one listener sees every pane.
`injectJkOSTheme()` already calls it, so no app wires it. It is a `data-` attribute and not a
class because `className` is React's to own. Pure enhancement — the pointer rungs and the
resting mark work without it, which is why the static jkAuth pages need nothing.

**The geometry.** The bar is **10px and the mark is 2px** — a 4px transparent border plus
`background-clip: content-box`, so the hit box stays a comfortable pointer target while the
mark stays fine. Restate `background-clip` on every state (and prefer `background-color` over
the shorthand): a bare `background` resets clip to `border-box` and the 2px mark silently grows
to fill the whole 10px bar. The radius is a full pill (`999px`), not a `--hub-radius` step — at
2px anything softer than round is indistinguishable from square. The **corner** stays
transparent; an *unstyled* corner paints an opaque OS-grey square, and `::-webkit-scrollbar-track`
is explicitly cleared because styling any part opts the bar into the legacy one, which paints
an OS track unless told otherwise.

**Gecko gets one rung, deliberately.** `scrollbar-color` **inherits** — a `:hover` rule to
reveal the mark also hands the revealed value to every nested scroller under the hovered
element, so pointing at anything lights up every bar on the page at once. Gecko can neither
round nor inset the mark either, so the choreography buys nothing there: it takes the resting
rung always, and the colour alone carries the design. Blink carries all four.

**Controls (state half)** — one rule across the set: a neutral debossed track that fills
with the accent (or `--jk-tint`) as it engages; each hosts on a real form/aria element so
the platform keeps the keyboard, and state styling keys off the aria attribute:
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
- `.jk-hit` / `.jk-scroll` — the two generic affordances every app was hand-rolling.
  `.jk-hit` is the hover response for anything clickable with no button face (a goal card,
  a calendar cell, a caret): it lifts the background to `--hub-bg-4` and takes a 1px press,
  and that is deliberately all. `.jk-scroll` is the scroll region — **vertical only**, so a
  long title can never shove a pane sideways. It carries no *bar* styling: the hairline is
  stated on the bare pseudo-elements, so a pane that forgot the class still gets the mark.
- `.jk-divider` — `.jk-rule`'s vertical sibling: the 1×14px hairline that separates clusters
  *inside* a bar (header sources | clock | avatar, a folio head, ORDECK's footer strip).

**Deepen inks — two, and they are not interchangeable:** `--accent-deepen-ink` (`#2a1c0e`)
is the ACCENT CHAIN's paper deepen target, used by the accent derivation and the solid chip
fill. `--bar-deepen-ink` (`#1a0a00`) is one stop darker and belongs to METERS — it is the
dark end of `--hub-amber-dim` and of every `<Bar>` gradient, so a per-item meter deepens
exactly the way the amber family does. Never inline either hex (§13.3); `<Bar>` exists so
the meter one can't be retyped. `--hub-shadow-panel-ink` is the shadow ink for a floating
panel/drawer/modal — direction is the call site's business, the ink is not.

**Global:** scrollbars (10px bar / 2px hairline mark, `--hub-scroll-mark-*` three-rung
two-face set, `[data-scrolling]` for the motion rung) and `::selection` (accent-dim ground,
bright ink) are styled once — don't restyle per app.

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
| **BeigeBoard** (planner) | React 18, plain CSS (`src/app.css`) | Fraunces | `radius: { base 8, xs 4, sm 7, lg 11, soft 9, widget 10, button 8 }` | **Full Press rebuild (2026-07-20)** — a view-layer redesign onto the new solid-ink chip system (the editorial pass 2026-07-19 was its masthead/rules groundwork; the folio retired for bordered `.jk-lab` week/date chips). **Today** = kit `DayView` single-day timeline + a 388px right rail (`.jk-sheet` bench + goals-in-press rollups + `.jk-colophon`); **Week/Calendar** = the reskinned kit views unchanged at the app level (the kit now owns the chrome — seven framed gapped day-lanes, today = tinted `jk-well` + `jk-press`); **Workshop** = a two-pane forge (goal rail, `jk-well` when selected → header `jk-press-lg` + `jk-rule` + expand/collapse milestone→leaf tree, each leaf a `.jk-chip` + `.jk-check`), retiring the drill-down + weekly bench + carried/adrift/next planning intel; **header** = pressed serif wordmark + `.jk-lab` chips + **mono** nav (active = `jk-well` + `jk-press`) + `.seg` clock. Motion on the `data-motion` axis (`.mo-item` rows, ambient rake/buzz opt-in; intro presses on paper). DetailPanel kept + restyled as the edit surface. Desktop only — `src/mobile/*` untouched behind `useBreakpoint()`; drag via `usePointerDrag`. **Parity pass (2026-07-29)** brought it to the prototype: the timeline is 60px rows (17 × 60 = 1020px) with hour rules in `--hub-line` and a half-hour ghost rule on Today only, all keyed off `density` so ORDECK's HUD keeps 48px; the gutter speaks **mono** (`.seg` only on the now badge, §13.12); the three 30px serif mastheads became one 46px `<ChromeBar>`; **Calendar was rebuilt** from a hairline table + 220px sidebar into 7×N gapped, individually bordered cells (the Week lane idea at month scale — sidebar now off by default, spanning all-day bars become a chip per covered day); Today's now-line names the live event and counts down, and the timeline opens where the day is; every view cascades from `MO_DELAYS` and no view double-animates. **Masthead + panel pass (2026-07-29)**: the header became a `.jk-masthead` (no fill/border, tapered ink ladder, `.jk-folio` edition mark, thumb-index nav) and the DetailPanel a `.jk-panel` overlay — see §8. Today's rail gained **Loose leaves**, the one section listing tasks filed under no goal (no goal anywhere up the parent chain, not merely `!parent_id`); before it, an unfiled task with no date and no `week_start` appeared on no screen at all. **Today's lane is marked by LIGHT, not by pigment**: `--jk-tint` 5% over `--hub-bg-4` (the brightest stock) with a `--color-line-strong` frame and `gridRules(density, { tone: 'strong' })`. The old recipe was the faint-CHIP wash (14% over `--hub-bg-2`), a mid-tone that sat at nearly equal lightness to BOTH its `--color-paper` neighbours *and* `--hub-line` — so the lane didn't read as marked and its hour rules vanished inside it. A wash too weak to see and strong enough to erase the ledger is the worst of both; the lit lane differs in the axis the eye actually finds, and gains rule contrast instead of losing it. Day's timeline takes `tone: 'strong'` too — it is drawn straight on the grained ground with no lane fill, the faintest pairing in the app. **Head/foot + month-ring pass (2026-07-30)**: the masthead ladder became **the inlay** (one tapered metal bead, hammered steel on paper / lit silver on the tube — §04) and the thumb-index nav went back to **boxed** tabs, because the box is what states light-vs-dark at a glance; the **page footer is gone** (colophon + rule both — the canvas keeps an 18px bottom margin and the page ends in air); and Calendar's day cells now enter on the **month ring** (`ringOrder`), starting on today and wrapping, so the entrance itself points at the current date |
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

**The choreography — `MO_DELAYS` / `stagger()` (`@jkos/design`).** hub.css owns the
physics; it cannot own the ORDER. `.mo-item` carries `both`, so an element with no delay
just *appears* — the entire cascade lives in the offsets, and those offsets were prose in a
work order until they became data. Import the region; never pick a number at the call site:

| Region | Delay |
|---|---|
| a view's header bar / masthead — every cascade starts here | `0ms` |
| the band under it: Week bench strip · Today rule · Calendar DOW row | `70` / `60` / `50ms` |
| the structural row below: Week day-heads · Calendar cell grid | `120` / `100ms` |
| the timeline itself: Week · Today | `170` / `110ms` |
| Today's right rail: first sheet → second sheet → colophon | `170` / `250` / `330ms` |
| indexed runs | `stagger(i, 60, 70)` goal cards · `stagger(i, 120, 40)` forge rows |
| the month grid's day cells | `ringOrder(day, anchor, count) × MO_RING_STEP` from `100ms` |

**The month ring — choreography as a POINTER (`ringOrder`, 2026-07-30).** The month grid is
the one grid in the suite with a *you are here*, so its cells do not enter in reading order.
The cascade **starts on today**, runs to the end of the month, wraps to the 1st and closes on
the day before — a ring, not a run. The eye follows where motion *begins*, so the entrance
names the current date before any pigment or light has to. The anchor is today only when the
cursor is on today's month; a month you paged to has no "now", opens from the 1st, and
degrades to plain reading order. Out-of-month gutter cells are not days, take no place in the
ring, and fill in together on the beat after it closes.
`MO_RING_STEP` is `15ms`, far tighter than a list's `70` — 31 cells at list pace would put
the last day of the month two seconds behind the first, and the whole sweep has to finish
inside ~half a second so the page is usable while it is still arriving. `ringOrder` is a pure
function with a unit test (`test/cards-logic.mjs`) asserting it is a **permutation** of
`0..count-1`: get the wrap wrong and the pointer aims at the wrong date, which no typecheck
and no eyeball on a single month would catch.

**Never stack entrances.** An `.mo-item` inside an `.ink-in` parent double-animates: the
parent fades the whole pane in while the child still holds its pre-animation frame. A view
that staggers internally must NOT also carry `ink-in` at the `<main>` boundary — the inner
cascade wins wherever there is one, because it says more. In BeigeBoard that is now **every**
view (Calendar was the last holdout and took the ring), so `<main>` carries no entrance class
at all; a future view with no internal cascade should take `ink-in` there. **The app header animates once,
on boot**, not with the view: it doesn't remount on tab change, so it takes a lone `.mo-item`
at `0ms` and each view then owns its own cascade from `0ms`.

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
