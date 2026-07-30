# BeigeBoard · Full Press — the build (to the interactive prototype)

*Deep-dive work order to build BeigeBoard up to the **interactive prototype**
(`~/Desktop/BeigeBoard - Claude Code Package/BeigeBoard.dc.html`, with its `jkos.css` /
`press.css` snapshots). Supersedes the earlier "surface-physics reface" draft — the prototype
is a **view-layer redesign plus a new solid-ink chip system**, and per Jag (2026-07-20) that
system is the **suite-wide default going forward**. Fence = [DESIGN.md](DESIGN.md) §13; ship
discipline = §14.*

> **STATUS: SHIPPED — this is a historical work order, not a live checklist.**
> The rebuild it scopes landed as `f64c1ca` (merged to `main` as `d29bfcc`); Waves A–D are done.
> Its 23 `- [ ]` boxes were never ticked on the way out, so **read them as the original plan,
> not as open work** — a cold agent working down this list would rebuild what already exists.
> The successor doc for what remains is
> [BEIGEBOARD_PARITY.md](BEIGEBOARD_PARITY.md) (the fidelity pass), and the live backlog is
> [ToDo.md](ToDo.md) §7. Wave-0's numbered "Jag's calls" below are still binding.
>
> *Two corrections found while auditing this file (2026-07-30): its file links were all
> repo-root-relative, so every one of them 404'd from `Documentation/` — now re-based to `../`;
> and the four `workshop/` files C4 retired (`ShopFloor`/`NodePage`/`Bench`/`bits`) are deleted,
> so their links are now plain names.*

---

## Wave 0 — the brief, locked

Jag's calls (2026-07-20), so a cold agent doesn't re-litigate them:

1. **The new look is the suite-wide default.** The chip/press system is promoted into the
   design system (`@jkos/design` + `@jkos/cards` + `@jkos/ui`), **not** kept BeigeBoard-local.
   *"The factory needs to be able to handle anything this prototype throws at it — add anything
   you need to the factory, we'll trim dead code later."* → extending hub.css / the factory /
   the kit is **sanctioned** this pass (normally §14 design-pass territory).
2. **Drop the planning intelligence.** Carried / adrift / "next" logic goes. A new pipeline
   that fits the forge will be designed later. Today becomes the prototype's timeline + rails.
3. **Use the prototype's forge.** The two-pane goals-rail + expand/collapse milestone→leaf tree
   replaces the unlimited-depth drill-down + weekly-bench sidebar (PLANNING_METHOD.md retires).
4. **Desktop only.** Mobile is deferred for every app — *"the desktop gets implemented and
   finalized first, then mobile is our pièce de résistance."* Leave `src/mobile/*` untouched
   behind the `useBreakpoint()` gate; do **not** half-migrate it.

Also: **mode toggle stays in `SettingsDrawer`** (the prototype's in-header face toggle is a
demo affordance). **Keep the suite integration** the prototype can't show — auth
(`authFetch`/keepalive), weave, `usePointerDrag`, `SettingsDrawer`, the ORDECK HUD shelf, the
real items backend — and iterate.

**Still inside the fence** even with the factory grant: token **names** stay frozen (§13.1);
`data-mode` only (§13.2); no hardcoded hex/accent in a component — new looks read `--jk-tint`
/ `--accent` (§13.3); both faces × 5 accents (§13.4); `withAlpha()` for fades (§13.10);
SylibOS untouched (§13.11); the machine keeps mono (§13.12). One direction only:
`@jkos/design` → `@jkos/ui`/`@jkos/cards` → app → mirrors.

---

## The prototype, decoded (what we're building)

- **A new chip vocabulary** (`bb-chip*` / `bb-press*` in the prototype) — the decided default
  is **"Opt 4 fill + Opt 1 cut"**: a saturated `--jk-tint` fill deepened toward
  `--accent-deepen-ink`, cream **knocked out** and **pressed** into the type; mode-flips
  (debossed on paper, halated on the tube). Variants: `-solid`, `-live` (ring), `-done`
  (spent/flat), `-sm`. The right-hand **472px "Chip Foundry / Fit Lab"** panel is the
  designer's decision log (the four options + a stress test) — **not app UI; don't build it.**
- **Today** = a single-day **timeline** (06:00–22:00, positioned event blocks, a now-line with
  a pressed `NOW · … · N MIN LEFT` label) + a **388px right rail**: two `jk-sheet` cards —
  "The bench" (benched tasks, `jk-check` + pressed ink) and "Goals in press" (mini rollups) —
  and a `jk-colophon`.
- **Week** = a **bench strip** on top + **seven individually-framed, gapped day lanes**
  (each day its own bordered, rounded column with real air between them — the **day-separation
  is the whole point of the redesign**, deliberately *not* the current monolithic hairline
  grid). Today's lane = a tinted `jk-well` with a `jk-press` date; now-line on today.
- **Calendar** = a month grid of solid-ink `-sm` chips; today cell = `jk-well` + `jk-press`.
- **Workshop** = **two panes** — a goals rail (cards: dot · serif title · `.seg` % · bar ·
  leaf count; selected = `jk-well`) and **the forge** (selected goal header: `jk-press-lg`
  title + `jk-bubble-secondary` category + `.seg` %; `jk-rule`; then an **expand/collapse
  tree** of milestone branches → task leaves, each leaf a `jk-chip` + `jk-check`).
- **Header** = pressed serif wordmark · two bordered `jk-lab` chips (week no. + date) · **mono**
  nav tabs (active = `jk-well` + `jk-press`) · source dots + "N sources" · `.seg` clock · avatar.
- **Motion** = per-item staggered entrance (`.mo-item`: `inkDry` paper / `crtOn` dark) gated by
  a `data-motion` axis (full/entrance/static); ambient `rake-layer` (paper) / `buzz-layer`
  (CRT); reduced-motion honored.

---

## Wave A — the chip & press system → the design system (foundation)

Everything downstream reads these. Port the prototype's `bb-*` values verbatim, renamed `jk-*`,
mode-gated. **Nothing else starts until A is green.**

- [ ] **A1 · Pressed-type family → hub.css** (anchor after `.jk-press-lg`, [hub.css:750](../packages/design/tokens/hub.css#L750)):
      `.jk-press-ink` (neutral-ink title, pressed-shadow only — for task titles on tinted
      chips), `.jk-press-rev` (cream knockout on a solid tint — the loud chip title),
      `.jk-press-sm`. Mode-gated: paper = white top-catch + tint-dark bottom lip; dark = tint
      glow. (Prototype `BeigeBoard.dc.html:43-64`.)
- [ ] **A2 · Chip surface family → hub.css:** `.jk-chip`, `.jk-chip-solid`, `.jk-chip-live`,
      `.jk-chip-done`, `.jk-chip-sm` — all `--jk-tint`-driven (`unset → --accent`), solid fill
      `color-mix(... --jk-tint 82%, --accent-deepen-ink)`, inset bevel + drop on paper, halation
      ring on dark. This is the suite default; it sits beside `.jk-bubble`/`.jk-well`.
- [ ] **A3 · Extend the factory for what the prototype needs** (Jag's grant):
      **(a)** a `data-motion` axis (`full` / `entrance` / `static`) as a `buildJkOSTheme` input +
      hub gating, driving `.mo-item` staggered entrance — reconcile with the existing `.ink-in`
      ([hub.css:459](../packages/design/tokens/hub.css#L459)); add the `crtOn` per-item flick
      keyframe beside `crtExpand`. **(b)** ambient `.jk-rake` already exists (§12) — add the CRT
      `.jk-buzz` companion, same `data-motion="full"` gate. Keep all of it reduced-motion-gated
      in the one hub block.
- [ ] **A4 · `@jkos/ui` primitive:** expose `<Chip tint variant>` (+ the pressed-type as a
      `<Press ink|rev>` prop or `cx` helper) in [primitives.tsx](../packages/ui/src/primitives.tsx)
      and the barrel, so apps consume the primitive, not raw classes.
- [ ] **A5 · Ship the foundation:** document the chip/press system in [DESIGN.md](DESIGN.md)
      §4/§8 (it *supersedes* the kit's `ACCENT_GLAZE` chip look — call that out); regenerate the
      three mirrors + design page (§14); `pnpm check:tokens` / `check:design` green.

## Wave B — re-skin AND re-separate the calendar kit (`@jkos/cards`)

Two things live here: the **chip look** (one factory) and the **day-separation relayout** — the
load-bearing change that stops Week reading as a flat grid. Both land in the shared kit so
BeigeBoard *and* ORDECK inherit them.

- [ ] **B1 · Rewrite `cardSurface()`** in [surface.ts](../packages/cards/src/surface.ts#L45) to the
      solid-ink/pressed recipe (mode-gated), replacing `ACCENT_GLAZE` + the hardcoded `rgba`
      shadows. Add a reverse-press title helper (or have chips take `.jk-press-rev`). Point
      `chipCheckStyle` at the `.jk-check` look (mode-correct). Because
      [`TaskChip`](../packages/cards/src/TaskChip.tsx), `TimeBlock`, `AllDayBar` **all** consume
      `cardSurface`, this re-skins the entire kit in one place.
- [ ] **B2 · Day-separation — the point of the redesign (a RELAYOUT, not a re-skin).** Today's
      `WeekView` is one monolithic bordered grid ([WeekView.tsx:280](../packages/cards/src/WeekView.tsx#L280))
      whose days are divided only by `borderRight` hairlines, with today merely washed
      `--color-accent-soft` ([:286-301](../packages/cards/src/WeekView.tsx#L286)) — exactly the flat
      grid to kill. Rebuild it as **seven individually-framed, gapped day lanes**: each day is its
      own bordered box (real `gap` of air between columns, *not* hairlines; header rounded on top,
      body rounded on the bottom so the two read as one unit), the timed body carries a **per-lane**
      hour-gridline background, and **today's whole lane is a tinted `jk-well`** (not a soft wash)
      with a `jk-press` date. Prototype refs: day headers
      `BeigeBoard.dc.html:173-180`, lanes `:189-202`.
      Mirror the framing in `DayView` (its single lane framed the same way) and keep
      `CalendarView` month cells visibly distinct (today = `jk-well` + `jk-press`).
- [ ] **B3 · The rest of the grid chrome** across DayView / WeekView / CalendarView: mono
      hour-gutter labels, the **now-line** (accent dot with `--accent-halo` + accent rule + pressed
      `NOW ·…` label), day headers (`jk-lab` weekday + serif date).
- [ ] **B4 · Reconcile the kit's own primitives** ([primitives.tsx](../packages/cards/src/primitives.tsx):
      `Checkbox`/`Eyebrow`/`RecLamp`) onto `.jk-check` / `.jk-lab` so the kit stops shipping
      pre-Full-Press copies.
- [ ] **B5 · Density seam + gate.** The framed lanes are spacious (the prototype is 1440px); the
      small ORDECK `bb-week` widget can't take that as-is — add a kit `density`/`compact` variant
      (tighter gaps + padding, **lane framing preserved**) so the separation survives at every
      size instead of forking. `pnpm check:cards` stays green (kit purity + `withAlpha` ban).

## Wave C — rebuild BeigeBoard's desktop views

- [ ] **C1 · Today** → kit `DayView` (single-day timeline) in the left pane + a 388px right rail
      of two `jk-sheet` cards (**bench**: `week_start` set & no `due_date`, `jk-check` +
      `.jk-press-ink`; **goals in press**: `bar-track`/`bar-fill` + `.seg` %) + a `jk-colophon`.
      **Rewrite** [TodayView.tsx](../apps/beigeboard/src/views/TodayView.tsx) — retire
      `NextCard`/`CarriedStrip`/`AdriftStrip`/`Strip`/`EmptyDay`/`ClearedDay` and the
      carried/adrift/next logic (Wave-0 #2).
- [ ] **C2 · Week** → kit `WeekView` + a **bench strip** across the top (benched/unscheduled
      chips, drag onto a day via the existing `DragProvider`/`usePointerDrag`). Header = pressed
      "Week of…" + mono stats + `jk-tbtn` nav. Rewrite [WeekView.tsx](../apps/beigeboard/src/views/WeekView.tsx)
      (stays a thin kit wrapper — the reskin lives in the kit).
- [ ] **C3 · Calendar** → kit `CalendarView` (month), reskinned; header = `jk-press-lg` month +
      `jk-tbtn` nav. [CalendarView.tsx](../apps/beigeboard/src/views/CalendarView.tsx).
- [ ] **C4 · Workshop** → the prototype's **two-pane forge** (new components; retire
      ShopFloor (`ShopFloor.tsx`, deleted) /
      NodePage (`NodePage.tsx`, deleted) /
      Bench (`Bench.tsx`, deleted) / bits (`bits.tsx`, deleted)
      drill-down). Left rail = goal cards (`jk-well` when selected); right = the forge (goal
      header + `jk-rule` + expand/collapse tree). **Map to the item model:** goal → milestone
      (branch) → task (leaf); rollup = leaves done/total; add/toggle/expand wired to the real
      `onAddItem`/`onToggle`/`onUpdateItem`/`expanded`. Render the prototype's 3 levels; deeper
      existing nodes surface as leaves (see decisions). Keep `keyboard`/`aria` on the checks.
- [ ] **C5 · AppHeader** → the prototype: pressed serif wordmark, two bordered `jk-lab` chips
      (week no. + date), **mono** nav tabs (active = `jk-well` + `jk-press`), source dots +
      "N sources", `.seg` clock, avatar. **No** in-header face toggle. Keep the ConnectModal +
      SettingsDrawer + settings-button wiring. [AppHeader.tsx](../apps/beigeboard/src/components/AppHeader.tsx).
- [ ] **C6 · Motion + intro** → apply `.mo-item` staggered entrances at view/row boundaries via
      the `data-motion` axis; wire the app's ambient rake/buzz opt-in; make the
      [CinematicIntro](../apps/beigeboard/src/components/Overlays.tsx) brand **press** on paper
      instead of glow.
- [ ] **C7 · Keep suite integration:** auth/keepalive, weave, drag, SettingsDrawer, and the
      ORDECK HUD shelf. **DetailPanel stays** as the (restyled) edit surface for an
      event/task/goal — the prototype omits it, but editing needs a home; restyle to the new
      chips/press rather than delete (see decisions).

## Wave D — cross-app ripple + both-face QA

- [ ] **D1 · ORDECK inherits the reskinned kit** (`bb-week`/`bb-calendar` widgets + any
      `TaskChip` use). Verify the HUD holds in both faces × 5 accents; tune the kit if the louder
      chips break widget density. This is the "one of each" (§13.6) cost of putting the look in
      the kit — it's the point, not a regression.
- [ ] **D2 · BeigeBoard both faces × 5 accents** (amber·cyan default, **ice·coral** stress),
      all four views + forge + DetailPanel + ConnectModal + SettingsDrawer. Desktop only.
- [ ] **D3 · Interaction:** reduced-motion; no double-entrance stacking; drag still reschedules
      (bench→day, timeline move); `.seg`/clock live.
- [ ] **D4 · Gates + docs:** `pnpm test:contracts` + focused `check:tokens`/`check:design`/
      `check:responsive`/`check:cards`/`check:async-view`; regenerate the three token mirrors
      (hub.css changed) + design page; update [DESIGN.md](DESIGN.md) §8 (chip system) + §11
      (BeigeBoard row → the rebuild). Build all four Vite apps. Branch `staging`; **quote the
      space in the repo path.**

## Wave E — seams to leave clean (do NOT build now)

- [ ] **Mobile** stays as-is behind `useBreakpoint()`; the whole `src/mobile/*` tree is the next
      pass (the showpiece). Don't touch it — a half-migrated mobile is worse than a deferred one.
- [ ] **The new planning pipeline** (replacing carried/adrift) is Jag's to design against the
      forge; leave a comment where it would hook into Today's rail.

---

## Decisions during build (not blocking — flag, don't stall)

- **Chip naming:** promote the prototype's `bb-chip*`/`bb-press*` → `jk-chip*`/`jk-press-ink`/
  `jk-press-rev` (suite default). Assumed yes.
- **Header identity:** the prototype uses bordered `jk-lab` week/date chips, not `.jk-folio`.
  Assumed match-the-prototype; the `.jk-folio` from the editorial pass retires here.
- **DetailPanel:** kept and restyled (the prototype has no detail panel, but item editing must
  live somewhere). If you'd rather fold editing into the timeline/forge inline, say so.
- **Forge depth:** the forge shows 3 levels (goal → milestone → task); BeigeBoard's data allows
  deeper nesting — assumed we render deeper existing nodes as leaves and cap *new* creation at 3.
- **Kit vs fork:** the calendar look is going **into `@jkos/cards`** (B), so ORDECK inherits and
  we honor "one of each." If ORDECK's HUD can't take the louder chips, the fallback is a kit
  `density`/`skin` prop — not a BeigeBoard fork.
