# Brief for Claude Code — set the Full Press, wave by wave

*This is the prompt. Your context is two documents: `Documentation/DESIGN.md` (the whole
system — tokens, classes, APIs, the fence, the working agreement) and the **Full Press
Rollout Dossier** (`Full Press Rollout Dossier.dc.html` — the plan of record, five waves
21→25, in order). `press.css` is the diff; `packages/design/tokens/hub.css` is the source
of truth. The live page at staging.jkos.net/design is your eyes. Where any of these
disagree, the code wins — and you fix the doc.*

## Mission
Full Press is settled and loved — do not redesign it. Your job is to *land* it: fold the
76-line `press.css` layer into the frozen token chain, re-cut the `@jkos/ui` primitive
layer, and carry the new voice into every app, without crossing the fence (DESIGN.md §13).
The signature is fixed: **humans read print (Fraunces), the machine speaks mono (Plex
Mono), the tube emits (Big Shoulders + halation)**. You are executing a plan, not authoring
one — when the plan is ambiguous, flag it, don't improvise.

## The plan of record
Work the dossier's waves in sequence; each is a shippable unit:

1. **Wave 21 — fold the layer in.** Merge `press.css` values + class faces into `hub.css`
   (values only; token names frozen, §13.1). Promote Fraunces to a factory `fonts.serif`
   input suite-wide and load Big Shoulders on the dark face (§5 known gap). Rewrite the
   affected DESIGN.md tables + the Voice doctrine. Extend the gates. Regenerate every
   mirror. **Nothing downstream starts until 21 is green.**
2. **Wave 22 — re-cut `@jkos/ui`.** The Voice, letterpress chips, the rules ladder,
   folio-vs-tape, the seg verdict, off-state idiom, colophon, player title. Component
   *signatures freeze* (§13.5) — apps must inherit the reface for free.
3. **Wave 23 — per app,** in dossier order: jkAuth → PapyrOS → KourOS → BeigeBoard →
   ORDECK. **SylibOS is not touched** (§13.11). Each app runs the same checklist: folio
   audit, replace hand-rolled serif with the primitive, editorial-grid headings, off-state
   copy, both-face QA, regenerate mirror.
4. **Wave 24 — motion.** `inkDry` (paper) + the existing `crt-expand` family (dark) as
   entrances; `prefers-reduced-motion` gated; mind the fill-mode gotcha (§12).
5. **Wave 25 — harden.** Both-face visual regression, a11y, font perf, docs freeze, delete
   the now-merged `press.css` and the retired `.muted` aliases.

## How to work
- Move values **through existing seams** — tokens, factory inputs, class refinements —
  before adding CSS surface. Full Press adds only a handful of genuinely new classes
  (`.jk-rule*`, `.jk-folio*`, `.jk-colophon`); everything else is a re-face of an existing
  one. If you reach for a new primitive not in the dossier, stop and ask.
- Keep the discipline **one direction**: `@jkos/design` → `@jkos/ui` → kits/apps →
  generated mirrors. Never patch an app to compensate for something that belongs upstream.
- Every change holds in **both faces and all five accent slots** (§13.4) — amber·cyan is
  the system's face, ice·coral is the stress test.
- Respect scarcity (§13.8): the reface must not multiply LEDs, tape, or glow.

## The fence — clauses most at risk in a mechanical port
Frozen token names (§13.1); `data-mode` only, no `prefers-color-scheme` (§13.2); no
hardcoded hex/accent in a component (§13.3); one-of-each — don't fork
`AsyncView`/`SettingsDrawer`/`AppShell` per app (§13.6); `withAlpha()` for every fade
(§13.10); SylibOS off-limits (§13.11).

## Ship discipline (§14)
After **any** `hub.css` change, regenerate all three committed artifacts (`sync:tokens`,
`sync-tokens.mjs`, `build-design-page.mjs`) and run the gates (`pnpm test:contracts`, or
the focused `check:tokens`/`check:design`/`check:responsive`/`check:cards`/
`check:async-view`). Verify in both faces × five accents × three breakpoints. **The repo
path contains a space — quote it.** Branch is `staging`. One PR per wave, with a short
rationale per change in the system's vocabulary (which face, which accent move, what got
scarcer).

## First move — resolve before writing code
The dossier closes with six open decisions (merge-vs-layer, roster/order, wave numbering,
hand-rolled primitives, Fraunces-always-on, seg-on-paper). Read them, state your
assumption on each, and surface anything you can't answer from DESIGN.md **before**
starting Wave 21. Then begin.

## Deliverables
Per wave: concrete diffs, updated DESIGN.md value tables, regenerated artifacts, green
gates, and a both-face screenshot pair as evidence.

---

## What's in this package
| File | Role |
|---|---|
| `00 - Claude Code Brief.md` | This prompt. |
| `Full Press Rollout Dossier.dc.html` | **The plan of record.** Five waves, tasks, per-task fence notes, six open decisions. Open in a browser; flip the Paper/Dark switch. |
| `press.css` | **The diff to fold in (Wave 21.1).** 76 lines over hub.css; values + class faces only, token names frozen. |
| `jkOS Full Press - Design Sheet.dc.html` | **Acceptance reference — PAPER face.** Every primitive re-cut, chapter by chapter. |
| `jkOS Full Press - CRT Sheet.dc.html` | **Acceptance reference — DARK face.** The same primitives, emissive. |
| `jkOS Canvas.dc.html` | Both-faces reference gallery (live paper|dark split). Use for both-face QA in Waves 23–25. |
| `jkOS Elevation - Three Philosophies.dc.html` | Provenance only — why Full Press ("Pressroom") was chosen and the fixed invariant. |
| `jkos.css` / `player-ui.css` / `support.js` | Support files so the .dc.html sheets render standalone. `jkos.css` is a snapshot of hub.css; `player-ui.css` mirrors the repo's. Reference only — do not port these; the repo copies win. |

## Note on DESIGN.md §15
`Documentation/DESIGN.md` §15 ("Brief for Claude Design") is now **spent** — Full Press is
the answer to its "known opportunities" (the seg face, off-states, login surfaces are all
resolved in Waves 22–23). Treat §1–§14 as live context and §15 as historical, superseded
by this dossier.
