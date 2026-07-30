# Building with jkOS

jkOS is a **paper-and-tube** design system with **two equal faces**. Neither is
the default and neither is a derived "dark mode" — they are two design
philosophies expressed by one set of markup:

- **Paper** — warm kraft ground. Ink is pressed *into* the sheet: letterpress
  relief, a white top catch-light over a deepened-accent lip, debossed wells,
  accent deepened toward the ink so vivid picks hold on kraft.
- **Tube** (`:root[data-mode="dark"]`) — near-black ground. Nothing is pressed,
  because there is no sheet: type and fills *emit*. Bevels are replaced by
  halation, the accent is used RAW (no deepening), wells glow rather than sink,
  and the CRT veils come alive.

**Design for both, always.** A layout that only works on one face is a bug. Never
hand-write a dark variant either — the same markup must produce both, so take
every value from a token and let the chain do the mode flip. Every preview card
in this project shows both faces side by side for exactly this reason.

**Scope:** this project contains only what **BeigeBoard's Full Press rollout
renders**, plus the shared **primitives** — 22 from `@jkos/ui` (incl.
`SettingsDrawer`) and the 15 `@jkos/cards` components the calendar tabs are
built from. Nothing else. The sheet is deliberately small enough to read in one
sitting: **two cells per component**, one showing the default and one showing
the single mode that actually differs. If you need a third state, compose it —
don't expect a card for it.

Excluded on purpose, and not to be reintroduced:

- **The accent-strip-down-the-left card** — a colour bar running down a card's
  left edge. This is a v0 pattern. **Never build one.** A card is a `<Sheet>`;
  carry colour with a tinted `<Chip>` / `<Well>` / `<Bar>`, or a `<Lab>`/
  `<Eyebrow>` in the item's hue.
- **The agenda day body** (`DayView mode="agenda"`). No app reaches it and it
  still carries that v0 card. Use `mode="grid"` — the default.
- **Anything from BeigeBoard's phone app**, which is still on v0 styles. It is
  a separate tree (`apps/beigeboard/src/mobile/`) and none of it is here.
- **`Calendar`** — the week/month/day dispatcher. It ships on the bundle global
  and BeigeBoard mounts its tabs through it, but it has no card because it draws
  nothing of its own: everything it shows is `<WeekView>`, `<CalendarView>` or
  `<DayView>`, which have their own. Reach for the body you want.

**The calendar views have ONE body at every width.** They used to swap in a
phone layout below 768px; that layout was never migrated off v0, so it moved out
to the app that wants it. Narrow one of these views and you get the same design,
scaled — `density="compact"` is the small mount, not a different look.

## 1. Setup — the ground is not optional

Load `styles.css`. It carries the token chain (`tokens/hub.css`), the vendored
brand faces (`fonts/fonts.css`), and the ground (`_ds_bundle.css`). The ground
sets `html body { background: var(--color-paper); color: var(--color-ink);
font-family: var(--hub-font-mono) }`. **Do not paint an opaque background over
`body`** — the body IS the ground, and covering it loses the surface the whole
accent chain is tuned against.

There is **no provider to wrap** — components read CSS custom properties, not
React context. The one exception is `<CalendarDragProvider>`, which only the
calendar grids need, and only for drag.

To retheme (accent pair, neutrals, radius, fonts), render `JkOSTheme` once near
the root. It emits a `<style>` of INPUT tokens; hub.css recomputes the whole
derived chain — for BOTH faces — from them. It ships on the bundle global but
has no card of its own, since it renders nothing visible.

```jsx
<JkOSTheme config={{ accent: { primary: '#c1352b', secondary: '#6b7f3a' } }} />
```

**Switching faces is exactly one attribute:** `data-mode="dark"` on `<html>`.
It must be on the document element — the dark rules are `:root[data-mode="dark"] …`,
so setting it on a wrapper div does nothing. Build a face toggle that writes to
`document.documentElement`, and check your work on both.

## 2. The styling idiom — tokens for values, `.jk-*` for marks

**Never invent class names, and never hardcode a colour.** Style your own layout
glue with inline styles or your own CSS, but take every *value* from a token:

| Purpose | Tokens |
|---|---|
| Surfaces | `--color-paper`, `--color-paper-2`, `--color-card`, `--color-card-2` |
| Type | `--color-ink`, `--color-muted`, `--color-faint` |
| Rules/borders | `--color-line`, `--color-line-strong` |
| Accent | `--color-accent`, `--color-accent-dim`, `--color-accent-glow`, `--color-accent-soft`, `--color-secondary` |
| Status | `--color-ok`, `--color-warn`, `--color-danger` |
| Faces | `--hub-font-serif` (Fraunces), `--hub-font-mono` (IBM Plex Mono), `--hub-font-sans` (IBM Plex Sans), `--hub-font-seg` (Big Shoulders) |
| Radius | `--hub-radius-xs`, `-sm`, `-button`, `-lg`, `-widget` |

The suite's own marks are `.jk-*` classes in hub.css, but **reach for the
component, not the class** — every one is wrapped: `.jk-press`→`<Press>`,
`.jk-chip`→`<Chip>`, `.jk-well`→`<Well>`, `.jk-sheet`→`<Sheet>`,
`.jk-lab`→`<Lab>`, `.jk-tbtn`→`<TButton>`, `.jk-bubble`→`<Bubble>`,
`.jk-rule`→`<Rule>`, `.jk-pill`→`<Pill>`, `.jk-sub`→`<Sub>`.

Per-item colour rides `--jk-tint`, which every tintable primitive exposes as a
`tint` prop (`<Chip tint="#4ecdc4">`, `<Well tint>`, `<Bar tint>`, `<Switch tint>`).
That is how a goal's own hue reaches a chip without a new class.

**`<Chip>` is a surface, not a finished control.** hub.css gives `.jk-chip` its
fill, radius and mode-gated shadow — and nothing else: no padding, no display, no
font. The box comes from YOUR call site. A bare `<Chip>text</Chip>` renders as a
highlighted run of text, not a chip:

```jsx
<Chip tint="#4ecdc4" style={{ display: 'inline-flex', alignItems: 'center',
      padding: '5px 8px', fontFamily: 'var(--hub-font-sans)', fontSize: 11.5 }}>
  <Press variant="rev">Design sync</Press>
</Chip>
```

Pair a **solid** chip with `<Press variant="rev">` (cream knockout) and a
**faint** one (`solid={false}`) with `<Press variant="ink" tint={sameTint}>`.

## 3. The voice — who speaks in which face

This is the rule that most distinguishes jkOS from a generic kit:

- **Humans read print** — running copy, titles, empty states: `--hub-font-serif`.
- **The machine speaks mono** — labels, codes, counts, timestamps: `<Lab>`, `<Sub>`.
- **Accent is scarce.** `<Press>` is *struck* type, not a filled badge; one
  `<Folio>` names one content panel; one `<Colophon>` closes one sheet. Loud
  everywhere means loud nowhere.
- Chip weight is **derived, never chosen per call site** — `chipState(item, now)`
  decides `live`/`spent`/`done`. `spent` (ended, never struck off) is deliberately
  only an opacity: the same chip, just behind you.

## 4. Where the truth is

Read these before styling anything: `_ds/<folder>/styles.css` and its imports —
especially `tokens/hub.css`, which is the single source for the whole chain and
carries the doctrine in its comments. Per component, read
`components/<group>/<Name>/<Name>.prompt.md` (usage + props) and `<Name>.d.ts`
(the contract). Components live in two groups: `general` (@jkos/ui primitives and
shells) and `cards` (@jkos/cards calendar kit). Both ship on `window.JkOS`.

## 5. An idiomatic build

```jsx
const { Sheet, Lab, Rule, Press, Sub, Chip, TButton, Colophon } = window.JkOS;

<Sheet style={{ padding: '20px 22px', maxWidth: 420 }}>
  <Lab size="sm">Week 31</Lab>
  <Rule weight="strong" />

  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '14px 0' }}>
    {[['Schedules', '16'], ['On the bench', '06']].map(([k, v]) => (
      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Sub>{k}</Sub>
        <Press>{v}</Press>
      </div>
    ))}
  </div>

  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Chip tint="#4ecdc4" style={chipBox}>
      <Press variant="rev">Design sync</Press>
    </Chip>
    <Chip solid={false} tint="#b8860b" style={chipBox}>
      <Press variant="ink" tint="#b8860b">Token parity</Press>
    </Chip>
  </div>

  <Rule weight="double" />
  <Colophon>Set in Fraunces and IBM Plex · jkOS</Colophon>
</Sheet>
```

…where `chipBox` is the call-site box from §2:

```js
const chipBox = { display: 'inline-flex', alignItems: 'center',
                  padding: '5px 8px', fontFamily: 'var(--hub-font-sans)', fontSize: 11.5 };
```

Note the pairing rule: a **solid** `<Chip>` takes `<Press variant="rev">` (cream
knockout); a **faint** chip takes `<Press variant="ink">` with the same tint.

## 6. Traps

- `.jk-sub-link` draws its underline with `border-bottom`. Rendering `<SubLink
  as="button">` and resetting `border: none` silently erases the mark — clear
  only top/left/right.
- `<Scanlines>` / `<Vignette>` / `<Scrim>` are absolute overlays: the host needs
  its own positioning context. Scanlines are near-invisible by design on the
  tube and disabled outright on paper.
- The calendar views (`<Calendar>`, `<WeekView>`, `<DayView>`, `<CalendarView>`,
  `<YearView>`) fill their host — give them a bounded flex column or they
  collapse. They lay out 06:00–22:00 at 60px/hour (`comfortable`) or 48
  (`compact`), so a 13:00 block sits 420px down.
- `<Switch>` and `<Check>` accept `disabled` but hub.css gives it no styling —
  a disabled toggle is pixel-identical to an enabled one. Don't rely on it to
  communicate state.
