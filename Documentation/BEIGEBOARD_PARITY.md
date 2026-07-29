# BeigeBoard · Design Parity — the work order

*Reference implementation: `BeigeBoard.dc.html` (the interactive prototype, 1440×940) plus
`jkos.css` / `press.css` snapshots in the **BeigeBoard - Claude Code Package**. Successor to
[BEIGEBOARD_FULL_PRESS.md](BEIGEBOARD_FULL_PRESS.md) — that doc scoped the **rebuild**, and the
rebuild shipped (`f64c1ca`, merged to `main` as `d29bfcc`). This doc scopes the **parity gap**:
the app is structurally right and visually flat next to the prototype. Fence =
[DESIGN.md](DESIGN.md) §13; ship discipline = §14. Working branch is `staging`.*

---

## How to read this

Every item cites the repo file and the prototype value it must match. Where a number is given,
it is the **prototype's literal value** — copy it, don't approximate it.

**One rule above all:** the prototype is the spec. Where this doc and the prototype disagree, the
prototype wins. Where the prototype and DESIGN.md §13 disagree, **§13 wins** — flag it in the PR
body rather than crossing the fence.

Order is **P0b → P0 → P1 → P2 → P3**. Note that this inverts the incoming draft: P0b (the
primitives) lands *first*, because P0's literals are the very numbers P0b makes importable.
Doing P0 first means typing them twice.

---

## Corrections to the incoming draft

The draft was audited item-by-item against the tree. It is accurate on nearly all of its
factual claims — the five-point verdict, the eight dead `.bb-*` references, the six hardcoded
`#1a0a00`s, the `.seg` gutter, the `--color-line-strong` grid ink, the two-file `.mo-item`
footprint, Calendar's hairline table and 220px sidebar. Those are all confirmed and stand as
written. The following are **not** carried over as written:

1. **Accent slots — the draft's correction is backwards; make no doc change.** The draft says
   "`ACCENT_SCHEMES` — **four** accent pairs is the code's truth… the brief and ToDo 26.1 say
   five — correct the docs to the code." The code disagrees with the draft. The chooser has
   **five slots: four presets + one Custom slot**, which is stated in the source itself
   ([accentSchemes.ts:3-8](../packages/design/theme/accentSchemes.ts#L3-L8)), enforced by
   `CUSTOM_SCHEME_ID` + `matchAccentScheme()`, rendered as five by
   [SettingsDrawer.tsx:258](../packages/ui/src/SettingsDrawer.tsx#L258), and fenced by DESIGN.md
   §13.4 ("all five accent slots") and §13.6 ("one accent chooser (five slots)"). Docs and code
   already agree. **Editing DESIGN.md or ToDo 26.1 to say "four" would introduce the error, not
   fix one.** The draft also contradicts itself here — its own P3 says "both faces × five
   accents". Five slots, four presets, no fifth pair invented, nothing to correct.

2. **New hub.css classes break `check:design` unless the design page demos them.** The draft
   names two of the three derived artifacts and never mentions the template. `check:design`
   ([test/design-page.mjs](../test/design-page.mjs)) scans **every top-level class hub.css
   defines and fails if the template doesn't use it** — so `.jk-hit`, `.jk-scroll`,
   `.jk-chip-spent` and `.jk-divider` each need a demo block in
   `apps/jkauth/scripts/design-template.html`, and the page must be rebuilt. Per DESIGN.md §14
   the full regeneration is **three** commands, not two:
   ```bash
   pnpm --filter @jkos/jkauth sync:tokens          # jkAuth static mirror
   node jkos-deploy/scripts/sync-tokens.mjs        # jkos-deploy static mirror
   node apps/jkauth/scripts/build-design-page.mjs  # the /design snapshot
   ```

3. **P0.4 is dropped; P0b.1 absorbs it.** The draft adds `.bb-hit`/`.bb-scroll` to
   `apps/beigeboard/src/app.css` in P0.4 and then supersedes itself in P0b.1 with
   `.jk-hit`/`.jk-scroll` in hub.css. Only the second version is kept. The **deletions** P0.4
   asked for survive intact and move into P3's sweep.

4. **The "hardcoded 48s" sweep is a no-op.** `grep` for `* 48` / `/ 48` across
   `packages/cards/src` returns **nothing** — all timeline geometry already flows through
   `WV_ROW_H`, and the drag path is fed declaratively via `data-frac-scale={WV_ROW_H}`. The real
   hazard the draft misses is **[TimeBlock.tsx](../packages/cards/src/TimeBlock.tsx)**: it
   imports `WV_ROW_H` directly at `:12` and uses it at `:56–:64` for grid height, top, height and
   overflow clamping. Making the row density-derived means **threading `density` into
   `TimeBlock`** — a prop change the draft never mentions and the single most likely place for
   ORDECK's compact HUD to silently inherit 60px rows.

5. **Minimum block height is a kit-wide constant, not a Week detail.** The draft puts "minimum
   block height 26px" under P1.1 (Week chip inset) and writes it as `Math.max(26, end - start)`.
   The clamp actually lives at [TimeBlock.tsx:58](../packages/cards/src/TimeBlock.tsx#L58) as
   `Math.max(18, (end - start) * WV_ROW_H)` — shared by Week *and* Today, and expressed in
   pixels, not hours. It moves to **P0b.8** as `minBlockH(density)` (`default 26` / `compact 18`)
   so raising it can't crush the HUD.

6. **`CinematicIntro` — frozen.** The draft says both "frozen… no work" (P0b) and "same sweep,
   same rule" (P3). Frozen wins: it is a one-off theatrical surface outside the chip system.
   Removed from the P3 list.

7. **`SettingsDrawer` is a suite primitive, not a BeigeBoard surface.** It lives at
   `packages/ui/src/SettingsDrawer.tsx` and is the fence's "one settings tray" (§13.6) — jkAuth,
   ORDECK, PapyrOS and KourOS all render it. Restyling it inside a *BeigeBoard parity* order
   changes four other apps. It stays in scope (it's where P0b.12 surfaces) but is called out as
   **suite-wide blast radius**: conformance only, and it must be eyeballed in a second app before
   the order closes.

8. **`TAGTINT` does not exist in the repo — it is new work.** The draft lists tint-by-origin
   under "already primitives — use them, don't rebuild them", describing it as "resolver wiring
   the host never did". `mergeResolvers`/`DEFAULT_RESOLVERS` do exist and `sourceOf` is already
   injected at [CalendarView.tsx:21](../apps/beigeboard/src/views/CalendarView.tsx#L21), but
   `TAGTINT` appears **only in the prototype** (`BeigeBoard.dc.html:608`). The seam is real; the
   mapping has to be written. It is tracked as **P3.2**, not assumed.

9. **Audit basis.** The draft cites `main @ d29bfcc`. That commit is the merge of `staging`
   `f64c1ca`, so the audit is valid — but all work here lands on **`staging`**, per §14.

### Found during implementation

10. **`--accent-deepen-ink` already exists — and it is a different colour.** The draft says
    to declare it as `#1a0a00`. It is declared at
    [hub.css:27](../packages/design/tokens/hub.css#L27) as **`#2a1c0e`**, and is already
    consumed by the accent chain and `.jk-chip-solid`. Pointing the six bar gradients at it
    would have *changed how they look* while claiming to be a no-op refactor. The six bars
    were replicating `--hub-amber-dim`'s formula (`72%, #1a0a00`) with a per-item tint — so
    the honest primitive is a **second** token, **`--bar-deepen-ink: #1a0a00`**, one stop
    darker, owned by meters. `--hub-amber-dim` now consumes it, `<Bar>` consumes it, and
    there is exactly one literal.
11. **P0b.12 (`DEFAULT_EFFECTS`) is already shipped — in CSS, which is where the fence wants
    it.** A `DEFAULT_EFFECTS` constant already exists in `@jkos/auth-client`, and the
    *per-face* behaviour the draft asks for is already implemented in hub.css:
    `.jk-rake` is gated `:not([data-mode="dark"])`, `.jk-buzz` `[data-mode="dark"]`, both
    under `data-motion="full"`; `.jk-scanlines`/`.jk-vignette` read
    `--crt-*-opacity`, which is `0` on paper and lit in dark; and `prefers-reduced-motion`
    kills all four. Re-expressing this as a per-face JS constant would duplicate a shipped
    constant and move face-gating out of hub.css, crossing **§13.9** ("CRT knobs are
    hub-owned"). **No work; verify in the browser instead.**
12. **Calendar's `repeat(5,1fr)` is only right for the month the prototype was drawn in.**
    A month starting late in the week needs a 6th row, and `buildMonthGrid` returns 42 cells
    for exactly that reason — hardcoding 5 would clip. The rebuild computes the row count by
    trimming trailing all-out-of-month weeks, so `1fr` rows always divide the pane evenly.
    Related: the month's **spanning `AllDayBar` had to go**. A continuous bar needs
    continuous columns, and the cells are now gapped — so a multi-day event surfaces as a
    chip in each day it covers, exactly as the Week lanes already resolved it.
13. **Today's "open where the day is" cannot be `max(now − 60min, first event − 30min)`.**
    Taken literally, a day whose first event is at 20:00 scrolls to the evening and hides the
    current hour. The two terms answer different questions: `now` is the anchor on today,
    and the first-event term is for days that *have* no now. Implemented as that conditional.

Everything else in the draft is carried over unchanged.

---

## Wave 0 — what is already true (do **not** rebuild)

Confirmed present and correct. Read for context, leave alone:

| Already shipped | Where |
|---|---|
| `.jk-chip` / `-solid` / `-live` / `-done` / `-sm` + `.jk-press-ink` / `-rev` / `-sm`, mode-gated | `packages/design/tokens/hub.css` L939–L1043 |
| `cardSurface()` re-cut onto the chip classes (`ACCENT_GLAZE` gone), `chipCheck` → `.jk-check` | `packages/cards/src/surface.ts` |
| Kit primitives folded onto suite classes (`Checkbox`→`.jk-check`, `Eyebrow`→`.jk-lab`, `RecLamp`→`now-dot`) | `packages/cards/src/primitives.tsx` |
| Week **framed, gapped day lanes** + `laneFrame()` + compact density + bench strip | `packages/cards/src/WeekView.tsx` |
| `@jkos/ui` primitives (`Chip`, `Press`, `Well`, `Sheet`, `Lab`, `TButton`, `Rule`, `Bubble`, `Check`, `Colophon`) | `packages/ui/src/primitives.tsx` + barrel |
| Today = kit `DayView` (grid) + 388px rail (bench / goals-in-press / colophon) | `apps/beigeboard/src/views/TodayView.tsx` |
| Workshop = two-pane forge, goal→milestone→leaf, rollups, add/expand wired to the real item model | `apps/beigeboard/src/views/workshop/WorkshopView.tsx` |
| Header = pressed wordmark + two bordered `Lab` chips + mono nav + source dots + `.seg` clock + avatar | `apps/beigeboard/src/components/AppHeader.tsx` |
| `data-motion` axis, `applyJkOSMotion`, `.jk-rake` / `.jk-buzz` mounted, `ink-in` on the view boundary | `App.tsx` L60, L405, L435 |

This is a **fidelity pass**, not another rebuild.

---

## The verdict — five reasons it reads flat

1. **The grid is 20% too tight and drawn in the wrong ink.** `WV_ROW_H = 48` against the
   prototype's `60`, and the hour rules paint `--color-line-strong` instead of the near-invisible
   `--hub-line` ([WeekView.tsx:512](../packages/cards/src/WeekView.tsx#L512),
   [DayView.tsx:335](../packages/cards/src/DayView.tsx#L335)). Together these turn a faint ledger
   into a dense spreadsheet and crush every solid-ink chip: a 60-minute event gets 48px to hold a
   12px serif title *and* an 8px mono meta line. Nothing else here matters as much.
2. **Two kit views never got the relayout.** Week did. **Calendar and the kit view headers did
   not** — the month grid is still a monolithic hairline table
   ([CalendarView.tsx:190](../packages/cards/src/CalendarView.tsx#L190), `:227`) behind a 220px
   sidebar (`:126`), and every kit view still opens with a pre-Full-Press serif masthead (`:155`,
   28px `<h2>`) instead of a tight chrome bar with mono stats and `.jk-tbtn` nav.
3. **The stagger doesn't play.** `.mo-item` appears in exactly two files, and Today's two sheets
   ([TodayView.tsx:81](../apps/beigeboard/src/views/TodayView.tsx#L81), `:133`) carry **no
   `animationDelay`**, so they fire together. The kit views carry none at all. The prototype's
   entrance is a *cascade*, and that cascade is most of the "gorgeous."
4. **Two CSS classes the views depend on do not exist.** `.bb-hit` and `.bb-scroll` are
   referenced 8× across desktop and mobile and are **defined nowhere**. Every hover affordance on
   the goal rail, the caret and the "WORKSHOP →" button is silently dead.
5. **The machine stopped speaking mono in the gutter.** Hour labels render `.seg`
   ([WeekView.tsx:465](../packages/cards/src/WeekView.tsx#L465),
   [DayView.tsx:299](../packages/cards/src/DayView.tsx#L299)), which on paper is Fraunces lining
   figures. The prototype's gutter is IBM Plex Mono — machine annotation, not a readout. Only the
   *now* badge is `.seg`. This is §13.12, not taste.

---

## P0b · Primitives — land these first

*The audit's findings were mostly **repetition**, not omission: one unstated decision
re-implemented per view, or a shared visual item that never got promoted. Twelve primitives
absorb them — and a primitive is how a rule stops needing to be remembered. `chipState()` is the
reason nobody has to recall that an ended-and-undone event sits at `.68`.*

Each lands in a package, gets a row in [PRIMITIVES.md](PRIMITIVES.md), and — for the `hub.css`
ones — a DESIGN.md §8 class-catalog entry, **a demo block in `design-template.html`**, and all
three regenerated artifacts (correction 2). `pnpm install` after every `packages/*` edit or
consumers keep the stale copy. The four load-bearing ones are **1**, **5**, **7** and **8**.

### Tokens and classes — `packages/design/tokens/hub.css`

- [ ] **1 · `.jk-hit` + `.jk-scroll`.** The two classes referenced 8× and defined nowhere
      (verdict #4). Generic hover affordance and scroll region, so they belong in hub.css where
      ORDECK and PapyrOS can stop hand-rolling their own:
      ```css
      .jk-scroll { overflow-y: auto; overflow-x: hidden; }
      .jk-hit { transition: background .12s, border-color .12s, color .12s, transform .1s; }
      .jk-hit:hover  { background: var(--hub-bg-4); }
      .jk-hit:active { transform: translateY(1px); }
      ```
      Then rewrite all 8 call sites (including the two mobile ones — that is the only sanctioned
      mobile change in this order) and add `bb-hit`/`bb-scroll` to P3's orphan grep.
- [ ] **2 · `--accent-deepen-ink: #1a0a00`.** The raw hex hardcoded in six progress bars — a
      §13.3 fence violation already shipped. Declare it beside the accent block; one value serves
      both faces. **`hub.css:183` already inlines this same hex** inside `--hub-amber-dim` —
      point it at the new token so there is exactly one literal. Consumed by primitive **5**,
      which is what keeps it from being retyped a seventh time.
- [ ] **3 · `.jk-chip-spent`** — `opacity: .68`. Completes the shipped `.jk-chip-live` / `-done`
      set with the state nobody named: **ended, not done**. This is the whole of the dimming
      behaviour; it makes `now` read as a position in the day rather than a line drawn across it.
- [ ] **4 · `.jk-divider`** — `width:1px; height:14px; background: var(--color-line)`. The
      hairline between header clusters (P1.5), and the same one ORDECK's footer strip and the
      folio head draw by hand. Three implementations, one rule.

### React — `@jkos/ui`

- [ ] **5 · `<Bar value tint />`.** The progress bar exists six times (`TodayView:164`,
      `WorkshopView:170/:214/:244`, `DetailPanel:267/:324`), each re-declaring the gradient:
      ```
      linear-gradient(90deg, color-mix(in srgb, var(--jk-tint) 72%, var(--accent-deepen-ink)), var(--jk-tint))
      ```
      Props: `value` (0–1), `tint`, `height` (5 rail / 6 branch inner / 7 forge — the three
      heights in Appendix A), `radius`. Replaces `.bar-track` + `.bar-fill` hand-assembly at every
      call site. Six copies → one, and the fence violation becomes structurally unrepeatable.
- [ ] **6 · `<EmptyState line sub />`.** The print idiom (§15.3) — italic Fraunces line + a
      `mono-eyebrow` sub — currently written per view, present in Today's bench and the forge and
      missing everywhere else. Component owns the treatment; **copy is a prop**, so each view
      still speaks for itself.

### Calendar kit — `@jkos/cards`

- [ ] **7 · `chipState(item, now)`** → `'upcoming' | 'live' | 'spent' | 'done'`, plus
      `chipStateClass(state)` → the class from **3**. Pure, colocated with `datetime.ts`, asserted
      in `pnpm test:cards`. Wave 0 shipped the classes; nothing ever decided **where they get
      applied**, so every block in the grid currently carries the same weight. Called from every
      surface that renders an item — Today grid, Week lanes, Calendar cells, bench chips, forge
      rows, leaves, and ORDECK's `bb-week` for free.
- [ ] **8 · Geometry by density, not by constant.** `packages/cards/src/constants.ts` +
      `datetime.ts`: `rowHeight(density)` (`default 60` / `compact 48`), `labelW(density)`
      (`52` / `60`), `minBlockH(density)` (`26` / `18`, per correction 5), `chipInset(density)`
      (Week `+5/−10`, Today `+6/−12`), `gridRules(density, { halfHour })` returning the
      `repeating-linear-gradient` stack. **Supersedes the bare-constant halves of P0.1 and
      P0.2** — same literals, one source. **Thread `density` into
      [TimeBlock.tsx](../packages/cards/src/TimeBlock.tsx) (correction 4)** — it owns grid height,
      top, height and the overflow clamp, and is where compact would otherwise inherit 60px rows.
      Keep `WV_ROW_H` exported as `rowHeight('default')` for any outside importer, but no view may
      read it directly.
- [ ] **9 · `<ChromeBar>`** — the 46px view header: `<Press>` title · `mono-eyebrow` stat line ·
      `margin-left:auto` `.jk-tbtn` nav trio. Verdict #2 is that Calendar and the kit view headers
      never got the relayout; they're all the same bar, so P1.1 / P1.2 / P1.3 each describing it
      separately is three chances to drift. Also what ORDECK's folio head wants. Props: `title`
      (node — Calendar passes roman + italic year), `stats`, `nav`.
- [ ] **10 · `<NowLine label? />`** — 8–10px `now-dot` with `--accent-halo` and negative margin, a
      2px accent rule, and the optional pressed mono label. Implemented twice today
      (`WeekView:553`, `DayView:375`) differing only by `label`. The label counts down and names
      the live event — it takes `chipState`'s `'live'` item, so **7** and **10** land together.

### Motion and ambience — `@jkos/design`

- [ ] **11 · `MO_DELAYS` + `stagger(i, base, step)`.** The physics are in hub.css and the axis is
      wired; the **choreography** is missing, and P2's delay table is currently prose. Export it as
      data — the region→ms map, plus the helper for indexed runs (`stagger(i, 60, 70)` for goal
      cards, `stagger(i, 120, 40)` for forge rows). One rhythm the whole suite reads instead of
      four apps inventing their own ms values. **P2 becomes "import the map."**
- [ ] **12 · `DEFAULT_EFFECTS`** — ambient defaults per face: **paper** = rake only (halation on,
      scanlines off, vignette off); **dark** = scanlines + vignette + buzz. The prototype runs
      everything always because it's a mock on a canvas; nothing ever said what the real app
      defaults to. Consumed by `<SettingsDrawer>` and every app shell; the user's `effects`
      preferences override, `prefers-reduced-motion` kills all of it. **Suite-wide blast radius
      (correction 7)** — verify in a second app before closing.

### Already primitives — use them, don't rebuild them

| Existing primitive | Resolves |
|---|---|
| `TButton` / `.jk-tbtn` | P0.4 — drop `.jk-cards-btn`'s inline font/letter-spacing/text-transform so the class can land. |
| `<Lab>` / `.jk-lab` | P0.3's mono gutter. `.seg` stays on the now badge — mono annotates, `.seg` reads out. |
| `laneFrame()` | Calendar's gapped, individually-bordered cells (P1.3) are Week's lane idea at month scale. Reuse it. |
| `ACCENT_SCHEMES` | **Five slots, four presets + Custom.** Per correction 1: no doc change. P3's QA matrix stresses two of the five. |
| `datetime.ts` lane packing | **Equal-width lanes**, no shingling (`left = lane × 100/lanes`). Every chip-inset number in **8** derives from it — add the assertion to `test:cards` so it can't quietly become shingled. |
| `usePointerDrag` | The row-height retune in **8** must flow through the one drag primitive — never a second drag system (`check:drag`). |
| `<SettingsDrawer>` | Where **12** surfaces. No per-app effects panel, no in-header face toggle. |
| `DEFAULT_RESOLVERS` / `mergeResolvers` | The tint seam. `sourceOf` is already injected; the `TAGTINT` map is **not written yet** (correction 8) → **P3.2**. |

### Stays a normal todo — BeigeBoard-local, nothing to promote

- **All of P1's literal metrics** — paddings, font sizes, lane framing, rail widths. Appendix A is
  their source.
- **The header** (P1.5), using **4** for the dividers, and one `.mo-item` at `0ms` — the header
  animates **once on app boot**, not with the view, since it doesn't remount on tab change. Each
  view then owns its own cascade from `0ms`.
- **Zero-padded machine counters** — `03 ACTIVE`, `2 OF 5 DONE`. A copy convention, not a
  component: one line in DESIGN.md (mono counters pad to two digits; `.seg` readouts never pad),
  then per-callsite.
- **Open the timeline where the day is** (P1.2) — `max(now − 60min, first event − 30min)` on
  mount. One view today; promote if ORDECK's day widget wants it.
- **Empty-state copy** for the two views with none — via **6**: Week → *"A clean week. Nothing set
  in type yet."* / `DROP FROM THE BENCH TO SCHEDULE`; Calendar → *"No impressions this month."* /
  `CLICK A DAY TO OPEN IT`.
- **Calendar's 220px sidebar** — dropped in `view="month"` (P1.3).
- **P3's sweeps** — the faces × accents matrix, the DetailPanel / ConnectModal reface, Big
  Shoulders `800`, the `TAGTINT` wiring, and the orphan greps.
- **CinematicIntro** — **frozen** (correction 6). No work.

**No new design sheets** for DetailPanel / ConnectModal / SettingsDrawer. With P0b landed the
reface is conformance to twelve named primitives plus the Wave 0 chip system.

---

## P0 · Foundation — kit geometry and ink

Everything downstream inherits these. Land P0 and screenshot before starting P1; several P1 items
will already look right. **P0.1 and P0.2's constants come from P0b.8, not from fresh literals.**

- [ ] **P0.1 · Hour-row geometry.** Row `48 → 60`, label column `60 → 52`, via
      `rowHeight(density)` / `labelW(density)`. `WV_FIRST_H`/`WV_LAST_H` (6/22) are already
      correct — 17 rows × 60 = **1020px** of timeline, matching the prototype exactly. **Compact
      density keeps 48** (ORDECK widgets). The `* 48` sweep the draft asks for is a no-op
      (correction 4) — the actual work is threading `density` into `TimeBlock.tsx` so the drag
      math and the `data-frac-*` drop zones retune *with* the row, not against it.
- [ ] **P0.2 · Gridline ink.** Change the gradient stop from `--color-line-strong` to
      **`var(--hub-line)`**, then add the prototype's **half-hour ghost rule** — Today only
      (`DayView`, grid mode), layered as a second gradient *under* the hour rule. Both come from
      `gridRules(density, { halfHour })`:
      ```
      repeating-linear-gradient(to bottom, var(--hub-line) 0 1px, transparent 1px 60px),
      repeating-linear-gradient(to bottom, transparent 0 30px,
        color-mix(in srgb, var(--hub-line) 40%, transparent) 30px 31px, transparent 31px 60px)
      ```
      Week lanes get the hour rule only — the prototype deliberately keeps the seven-lane grid
      quieter than the single day.
- [ ] **P0.3 · The gutter speaks mono.** Replace `<span className="seg">` on the hour label with
      `<Lab>`-equivalent machine annotation: `fontFamily: var(--hub-font-mono)`, `fontSize: 9`,
      `letterSpacing: '0.06em'`, `color: var(--color-faint)`. **Keep `.seg` on the now-time
      badge** (accent-coloured, 10–11px): that one *is* a readout. §13.12.
- [ ] **P0.4 · `.jk-tbtn` for kit nav buttons.** The kit's buttons carry `.jk-cards-btn`
      (transition only) with a `FONT_BODY` 10px uppercase face — pre-Full-Press sans chrome. Every
      nav/action button in `WeekView` / `DayView` / `CalendarView` becomes
      `className="jk-cards-btn jk-tbtn"` (+ `jk-tbtn-quiet` for the secondary pair). Drop the
      inline font/letter-spacing/text-transform overrides so `.jk-tbtn` actually lands.
      *(The draft's P0.4 — app-local `.bb-*` classes — is dropped per correction 3; its deletions
      moved to P3.)*

---

## P1 · Per-view parity

### 1.1 · Week — `packages/cards/src/WeekView.tsx`

- [ ] **The header bar** — `<ChromeBar>` (P0b.9), replacing the 30px `<h1>` masthead:
      `height:46px; padding:0 28px; border-bottom:1px solid var(--hub-line)`; `<Press>` serif
      **700 / 1.15rem / −0.015em** `"Week of Jul 13 — 19"` · `mono-eyebrow` stats
      `"7 DAYS · 11 SCHEDULED · 3 ON THE BENCH"` · nav trio `← W28` (quiet) / `This week` /
      `W30 →` (quiet). The 30px h1 costs ~40px of timeline for no information.
- [ ] **The bench strip.** `padding:10px 28px`, `border-bottom:1px solid var(--hub-line)`,
      `background: color-mix(in srgb, var(--hub-bg-1) 30%, transparent)`; a `jk-lab jk-lab-xs` in
      `--color-accent` reading "The bench", a `mono-eyebrow` "UNSCHEDULED — DROP ONTO A DAY", then
      chips pushed right (`margin-left:auto`, `gap:8px`). Chips are faint `.jk-chip` + `.jk-press`
      — serif 600 / **11.5px** / `padding:5px 12px` / `cursor:grab`, tinted by the item's own
      accent (not the theme accent).
- [ ] **Day-head lanes.** Weekday **`mono-eyebrow`** (machine), date **serif 700 / 20px** pushed
      right with `margin-left:auto`. Today's lane is a `jk-well` with
      `--jk-tint: var(--color-accent)` and a `.jk-press` date — **not** the accent-coloured italic
      currently at `:363–:364`. The prototype keeps today's number in ink and lets the well +
      press carry the state; the italic accent is a leftover from the editorial pass.
- [ ] **Lane framing metrics.** Column gap **11px**, gutter column **52px**, header
      `padding:9px 11px 7px` with `border-radius: var(--hub-radius-sm) var(--hub-radius-sm) 0 0`
      and `border-bottom:none`; body `border-top:none`, `border-radius: 0 0 sm sm`,
      `overflow:hidden`. Scroll region `padding: 0 28px 20px`, head row `padding: 14px 28px 0`.
- [ ] **Chip inset inside a lane** — from `chipInset('default')`:
      `left: calc(<lane%> + 5px); width: calc(<lane%> - 10px)`, `padding: 5px 9px`, title serif
      600 / 12px / −0.01em / ellipsis, meta `mono-eyebrow` 8px at `opacity:.8`. Minimum block
      height **26px** via `minBlockH` (P0b.8, correction 5) so a 15-minute sliver clips cleanly.
- [ ] **Now-line, today only** — `<NowLine>` (P0b.10), no label: 8px `now-dot` with
      `box-shadow: var(--accent-halo)` and `margin-left:-4px`, then
      `flex:1; height:2px; background: var(--color-accent); opacity:.75`.
- [ ] **Empty state** via `<EmptyState>`: *"A clean week. Nothing set in type yet."* /
      `DROP FROM THE BENCH TO SCHEDULE`.

### 1.2 · Today — `packages/cards/src/DayView.tsx` (grid) + `apps/beigeboard/src/views/TodayView.tsx`

- [ ] **The masthead.** `jk-press-lg`, serif **700 / 2rem / line-height 1 / −0.025em**,
      `"Saturday, July 18."` — with the full stop; it's the prototype's voice. Beside it a
      `mono-eyebrow`: `DAY <n> · <n> EVENTS · SUN SETS <hh:mm>` — **drop the sunset term rather
      than faking it** (no source in the repo); use `· <n> ON THE BENCH`. Pane padding
      `14px 30px 12px`, then `<hr className="jk-rule-strong">` at `margin: 0 30px`. Timeline
      scroll region `padding: 6px 30px 16px`.
- [ ] **Chip inset.** Wider than Week, from `chipInset`: `+6 / −12`, `padding: 7px 11px`, title
      serif 600 / **15px**, meta `mono-eyebrow` right-aligned on the title's baseline row
      (`display:flex; align-items:baseline; gap:9px; margin-left:auto`).
- [ ] **The now-line label** — `<NowLine label>`: 10px dot (`margin-left:-5px`) → 2px accent rule
      at `opacity:.7` → pressed mono label `NOW · <TITLE> · <N> MIN LEFT`, mono 8.5px / `.2em` /
      600 / `padding: 0 8px`. The label must name the *live* event (from `chipState`) and count
      down — a static "NOW" is worse than none.
- [ ] **Open the timeline where the day is.** Scroll so `max(now − 60min, first event − 30min)`
      sits near the top of the viewport, once, on mount. Landing on 06:00 every time is the single
      most-noticed daily papercut.
- [ ] **Rail stagger.** `TodayView.tsx:81` / `:133` carry `.mo-item` with no delay — take
      `MO_DELAYS` (P0b.11): `170ms` / `250ms`, and `330ms` on the `<Colophon>`.
- [ ] **Bench empty state** already carries the print idiom — leave it.

### 1.3 · Calendar — `packages/cards/src/CalendarView.tsx` — the least converted view

- [ ] **Header** — `<ChromeBar>`: `jk-press-lg`, serif **700 / 1.9rem / −0.02em**, `July` roman +
      `2026` **italic**; `mono-eyebrow` `31 DAYS · <n> ITEMS · CLICK A DAY TO OPEN IT`; nav trio
      `← Jun` (quiet) / `Today` / `Aug →` (quiet). Pane padding `16px 30px 22px`.
- [ ] **Day-of-week row.** `display:grid; grid-template-columns:repeat(7,1fr); gap:6px;
      margin-bottom:6px`, each a centred `jk-lab jk-lab-xs`. No borders, no background — kill the
      `borderRight` at `:175`.
- [ ] **The cell grid.** `repeat(7,1fr) × repeat(5,1fr); gap:6px; flex:1` — **gapped,
      individually bordered cells**, the same day-separation idea Week's lanes got (reuse
      `laneFrame()`). Each cell: `border:1px solid var(--hub-line);
      border-radius: var(--hub-radius-xs); padding:7px 9px; display:flex; flex-direction:column;
      gap:4px; overflow:hidden`. Kill the `borderRight`/`borderBottom` hairlines (`:190`, `:227`)
      and the fixed `minHeight: 90` — rows are `1fr` and the grid fills the pane.
- [ ] **Cell contents.** Day number serif **700 / 14px / line-height 1**. Items are
      `jk-chip jk-chip-solid jk-chip-sm jk-press-rev`, serif 600 / **10px** / `padding: 3px 7px`,
      single-line ellipsis, tinted per item, state from `chipState`. Out-of-month:
      `opacity: .36`, no items, no pointer. Today's cell: `jk-well` + `.jk-press` number. Every
      in-month cell gets `.jk-hit` and `cursor:pointer`, and clicking opens that day (Today tab).
- [ ] **The 220px sidebar** (`:126`) is not in the prototype's month view. **Drop it in
      `view="month"`** — the unplaced-tasks list is the Week bench strip's job. Keep it behind a
      prop defaulted **off** if another consumer needs it; note the call in the PR. It is the
      reason Calendar reads as a different app from the other three tabs.
- [ ] **Empty state** via `<EmptyState>`: *"No impressions this month."* / `CLICK A DAY TO OPEN IT`.

### 1.4 · Workshop — `apps/beigeboard/src/views/workshop/WorkshopView.tsx` — the last 5%

- [ ] `.jk-hit` on the goal cards and the caret starts working once P0b.1 lands — verify the hover
      reads (`--hub-bg-4` behind the card).
- [ ] Confirm goal-rail scroll `padding: 0 18px 12px`, `gap: 10`; forge scroll `padding:
      14px 28px 20px`, `gap: 7`; rail width **340px**; leaf indent **30px**.
- [ ] `GoalCard`'s `className={\`bb-hit mo-item${selected ? '' : ''}\`}` (`:156`) has a no-op
      ternary — clean it up as part of the `.jk-hit` rename.
- [ ] The `label-tape` "GOALS" is correct (machine chrome names a machine panel, §12) — leave it.

### 1.5 · Header — `apps/beigeboard/src/components/AppHeader.tsx`

- [ ] `height: 56 → 58`, `padding: '0 28px' → '0 26px'`.
- [ ] Wordmark `fontSize: 20 → 21`; `NavTab` padding `'6px 16px' → '7px 18px'`; subline keeps
      `marginTop: 3`.
- [ ] Source dots: keep the real source colours (they're informative) but match the
      dim/disconnected dot to `--color-line-strong` at `opacity:.3` and **drop the per-dot
      `0 0 4px` glow** — it's the one place the header buzzes.
- [ ] Add `.jk-divider` (P0b.4) between the sources cluster, the clock, and the avatar.
- [ ] One `.mo-item` at `0ms` — the header animates **once on app boot**, not per tab.
- [ ] **No in-header face toggle** — mode lives in `SettingsDrawer`. Unchanged.

---

## P2 · Motion — the cascade

`.mo-item` carries `both`, so an element with no delay just appears — the whole effect is in the
offsets. All values come from `MO_DELAYS` (P0b.11); this table is its content, not a second source.

- [ ] **Kit views get `.mo-item`** at the prototype's boundaries:
      | Region | Delay |
      |---|---|
      | Week header bar / Today masthead / Calendar header | `0ms` |
      | Week bench strip / Today rule / Calendar DOW row | `70ms` / `60ms` / `50ms` |
      | Week day-head row / Calendar cell grid | `120ms` / `100ms` |
      | Week + Today timeline grid | `170ms` / `110ms` |
      | Today rail: bench sheet → goals sheet → colophon | `170ms` / `250ms` / `330ms` |
      | Workshop goal cards | `stagger(i, 60, 70)` *(already correct)* |
      | Workshop forge rows | `stagger(i, 120, 40)` *(already correct)* |
- [ ] **Never stack entrances.** `App.tsx:405` puts `ink-in` on the `<main>` boundary; an
      `.mo-item` inside an `.ink-in` parent double-animates. Either drop `ink-in` from `<main>` for
      views that stagger internally (Today/Week/Calendar, exactly as Workshop already opts out) or
      make `ink-in` fade-only on those views. Pick one and comment the choice.
- [ ] **Don't put `.mo-item` on a `position:fixed` host.** The retained `both` fill makes the
      element a containing block — DetailPanel / CreateDialog / ConnectModal parents stay clean.
- [ ] **Verify the ambient tier.** `.jk-rake` / `.jk-buzz` mount at `App.tsx:435` and gate on
      `effects.halation → data-motion="full"`. Confirm the rake is visible on paper (it is
      `mix-blend-mode: soft-light` at ≤.42 opacity — easy to lose behind an opaque view background)
      and the buzz only on the tube. Reduced-motion kills both; check it does. Defaults come from
      `DEFAULT_EFFECTS` (P0b.12).

---

## P3 · Detail sweep

- [ ] **P3.1 · Both faces × the accent slots.** All four tabs + forge + DetailPanel + ConnectModal
      + SettingsDrawer, `paper` and `dark`, **amber·cyan** (the house face) and **ice·coral** (the
      stress slot) — two of the five slots, per §13.4's "must hold up" and correction 1. Solid
      chips on the tube must halate, not fill; `.jk-press-rev` must invert to tint + glow in dark.
- [ ] **P3.2 · Tint comes from origin, never theme.** Write the `TAGTINT` resolver
      (correction 8 — it does not exist yet): `DESIGN`→`--color-accent` · `DOCS`→`--hub-cyan` ·
      `INFRA`→`--hub-magenta`, merged alongside the already-injected `sourceOf`. Goals and
      milestones resolve to the goal's own `tint`. Precedence **origin → parent → theme**.
- [ ] **P3.3 · DetailPanel** (28KB) was kept-and-restyled per Wave C7 but never audited against the
      chip system. Sweep for pre-Full-Press faces: raw `rgba()` shadows, sans labels where
      `.jk-lab` belongs, `ACCENT_GLAZE`-era fills. **Restyle, don't redesign** — the prototype has
      no detail panel to copy from.
- [ ] **P3.4 · ConnectModal / SettingsDrawer** — same sweep, same rule. SettingsDrawer is
      suite-wide (correction 7): conformance only, eyeball it in a second app.
      **CinematicIntro is frozen** (correction 6).
- [ ] **P3.5 · Fonts.** `apps/beigeboard/index.html` loads Big Shoulders `400;600;700`; the
      prototype uses `800` for the largest `.seg` readouts (the 30px forge percentage). Add `800`
      or confirm 700 is intended and note it.
- [ ] **P3.6 · Empty states carry the idiom** (§15.3). Today's bench and the forge already do;
      Week and Calendar arrive with P1; check the loading state (`"Setting type…"` — good).
- [ ] **P3.7 · Grep for orphans:** `ACCENT_GLAZE`, `bb-chip`, `bb-press`, `bb-hit`, `bb-scroll`,
      raw `#1a0a00` outside hub.css, and any `--color-line-strong` used as a *grid rule* rather
      than a structural border. **Delete** the now-dead `.bb-goal-well` and `.bb-prog-track` in
      `apps/beigeboard/src/app.css`, and verify/remove the pre-Full-Press `.task-row`,
      `.day-chip`, `.event-chip` hover bridges (this is the surviving half of the draft's P0.4).

---

## Explicitly **not** in scope

- **The 472px "Chip Foundry / Fit Lab" panel** in the prototype is the designer's decision log —
  four chip options plus a stress grid. Not app UI. Don't build it.
- **The prototype's app frame** (`border-radius:14px`, `1px solid --hub-line-strong`,
  `--hub-shadow-card`, inset `jk-scanlines` + `jk-vignette`) is a mock affordance so the design
  reads as a device on a canvas. The real app is full-viewport. Don't port the frame.
- **The in-header face toggle** — demo affordance; mode lives in `SettingsDrawer`.
- **Mobile** (`src/mobile/*`) stays behind the `useBreakpoint()` gate. The **only** sanctioned
  mobile change is the two `.bb-scroll` → `.jk-scroll` renames in P0b.1.
- **The planning pipeline** replacing carried/adrift is Jag's to design against the forge. The
  seam comment in `TodayView.tsx` stays.
- **CinematicIntro** — frozen.

---

## Next orders, sequenced

Out of scope here; each wants its own order, in this order:

1. **jkAuth** — the unblocker. ToDo 26.1: the jkAuth image must rebuild before `/design` and the
   login reface go live.
2. **`/design` regeneration** — the Design Sheet + CRT Sheet are the canonical spec. An acceptance
   checkbox here; a real order once jkAuth lands.
3. **ORDECK v3 HUD** — the full widget set. This order touches ORDECK only as a regression risk.
4. **PapyrOS / KourOS deep passes + `player-ui.css`** (see [PLAYER_PARITY.md](PLAYER_PARITY.md)).
5. **BeigeBoard mobile** — drill-in + compact bench rail (ToDo §5); needs design first.

Studies, resolved: **Elevation — Three Philosophies** → codify the sink/rise doctrine as one line
in DESIGN.md §13 (the press system implements it; the doctrine isn't written down).
**Proto 3B-I/II/III + Tactile Motion** → archive as motion reference; `mo-item` / `rake` / `buzz`
is the shipped vocabulary. **jkOS Canvas** → overview surface, not shippable UI; archive.

---

## Acceptance

Screenshot-diff the four tabs against the prototype at **1440×940**, paper face, amber·cyan.

- [ ] Week: 17 hour rows at 60px = 1020px of timeline; seven framed lanes with 11px of air; hour
      rules barely visible; a 60-minute chip holds title + meta without clipping.
- [ ] Today: masthead + rule + timeline opens near now; now-line names the live event and counts
      down; rail cascades 170 → 250 → 330.
- [ ] Calendar: 7×5 gapped cells, no hairline table, no sidebar, today is a well.
- [ ] Workshop: hover reads on every goal card and caret.
- [ ] A past-and-undone event, a live event and a done event are three visibly different weights in
      all four tabs, on both faces — and all three come from `chipState`.
- [ ] `grep -rn '#1a0a00' --include=*.tsx --include=*.ts` returns nothing; no call site assembles a
      bar gradient by hand.
- [ ] `bb-hit` / `bb-scroll` appear nowhere; `.jk-hit` hover reads on every goal card and caret.
- [ ] ORDECK's `bb-week` / `bb-calendar` still render at compact density — `rowHeight('compact')`
      returns 48, `minBlockH('compact')` returns 18, and no view imports a bare `WV_ROW_H`.
- [ ] Tab-switching does not re-animate the header; no view double-animates; every delay traces to
      `MO_DELAYS`; `prefers-reduced-motion` kills all of it.
- [ ] Fresh profile on paper shows the rake and no scanlines; on dark, scanlines and buzz.
- [ ] `pnpm test:cards` covers `chipState` and equal-width lane packing.
- [ ] **The four new hub.css classes are demoed in `design-template.html`** and all three derived
      artifacts are regenerated (correction 2) — `check:design` and `check:tokens` green.
- [ ] `pnpm test:contracts` green (contracts + `check:tokens` / `check:design` / `check:responsive`
      / `check:cards` / `check:drag` / `check:hud` / `check:async-view` / `prove`).
- [ ] All four Vite apps build.
- [ ] [PRIMITIVES.md](PRIMITIVES.md) has a row for all twelve, in the right section.
      [DESIGN.md](DESIGN.md) §8 catalogs the four new classes, §11's BeigeBoard row is current, and
      §12's animation table reflects the codified `.mo-item` choreography. Branch `staging`.

---

## Appendix A — prototype reference values

Paper face, amber·cyan, 1440×940.

**Shell** — header 58px, `grid-template-columns: 1fr auto 1fr`, `padding: 0 26px`, `gap: 20px`;
wordmark serif 600 italic 21px −0.01em; nav tab `7px 18px`, label mono 11px/500/`.18em` uppercase,
subline mono 8px/`.14em` at `opacity .85` active / `.5` idle; `.seg` clock 15px; avatar 28px,
`--color-accent-deep` on a 1.5px `--color-line-strong` ring, serif italic 600 11px in
`--color-accent-bright`.

**Timeline** — `WV_FIRST_H 6`, `WV_LAST_H 22`, row **60px**, total **1020px**, gutter **52px**,
label mono 9px/`.06em`/`--color-faint`; now at minute 581 → `top: 221px`; min block **26px**.

**Week** — header bar 46px / `0 28px`; bench strip `10px 28px`, bg
`color-mix(in srgb, var(--hub-bg-1) 30%, transparent)`; lane gap **11px**; head `9px 11px 7px`;
date serif 700 20px; chip inset `+5 / −10`, `padding 5px 9px`, title 12px, meta mono 8px `.8`;
scroll `0 28px 20px`, heads `14px 28px 0`.

**Today** — pane `14px 30px 12px`, rule `jk-rule-strong` at `0 30px`, scroll `6px 30px 16px`;
title `jk-press-lg` 2rem/700/−0.025em; chip inset `+6 / −12`, `padding 7px 11px`, title 15px;
now dot 10px + 2px rule `.7` + pressed mono label 8.5px/`.2em`/600; rail **388px**,
`padding 16px 22px`, `gap 14`; sheets `var(--hub-radius)` / `16px 18px`.

**Calendar** — pane `16px 30px 22px`; title `jk-press-lg` 1.9rem/700/−0.02em (year italic);
DOW row `gap 6`, `margin-bottom 6`, `jk-lab jk-lab-xs` centred; grid `repeat(7,1fr) ×
repeat(5,1fr)`, `gap 6`; cell `1px --hub-line`, `--hub-radius-xs`, `7px 9px`, `gap 4`; number
serif 700 14px; chip serif 600 10px `3px 7px`; out-of-month `opacity .36`.

**Workshop** — rail **340px**, header `16px 20px 12px`, list `0 18px 12px` `gap 10`; card
`1px --hub-line`, `var(--hub-radius)`, `13px 15px`, `gap 8`, dot 9px, title serif 700 15px
−0.015em, `.seg` 16px, bar 5px/r3; forge header `16px 28px 12px`, title `jk-press-lg` 1.85rem,
`.seg` 30px, bar 7px/r4; rule at `4px 28px 0`; rows `14px 28px 20px` `gap 7`; branch
`10px 14px`, `--hub-radius-sm`, `1px --hub-line`, bg `--hub-bg-3`, inner bar 130×6; leaf indent
30px, `padding 8px 14px`, title 14px.

**Motion** — `inkDry .5s cubic-bezier(.2,.7,.25,1) both` (paper) / `crtOn .62s ease-out both`
(dark); rake `26s ease-in-out infinite`, buzz `4.3s ease-in-out infinite`, both `data-motion="full"`.

## Appendix B — file map

| Work | Files |
|---|---|
| P0b.1–4 (+ demo blocks, 3 mirrors) | `packages/design/tokens/hub.css`, `apps/jkauth/scripts/design-template.html` |
| P0b.5–6 | `packages/ui/src/primitives.tsx` + barrel |
| P0b.7–10, P0.1–P0.3 | `packages/cards/src/{constants.ts,datetime.ts,TimeBlock.tsx,WeekView.tsx,DayView.tsx,primitives.tsx}` |
| P0b.11–12 | `packages/design/theme/*.ts`, `packages/ui/src/SettingsDrawer.tsx` |
| P0.4, P1.3 | `packages/cards/src/CalendarView.tsx` |
| P1.2 (rail), P2 (delays) | `apps/beigeboard/src/views/TodayView.tsx` |
| P1.4 | `apps/beigeboard/src/views/workshop/WorkshopView.tsx` |
| P1.5 | `apps/beigeboard/src/components/AppHeader.tsx` |
| P2 (boundary) | `apps/beigeboard/src/App.tsx` |
| P3 | `apps/beigeboard/src/components/{DetailPanel,ConnectModal}.tsx`, `apps/beigeboard/src/app.css`, `packages/ui/src/SettingsDrawer.tsx` |
| Reference only | `packages/cards/src/surface.ts` — **do not** re-cut; Wave A/B1 are correct |
