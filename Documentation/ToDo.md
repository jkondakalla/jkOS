# jkOS — ToDo

The working backlog. **Completed work is summarized, not enumerated** — the task-level record
for a finished wave lives in the relevant `Documentation/*.md` (mostly ARCHITECTURE.md and
DESIGN.md). This file carries detail only for **open and future** work. Gate
(`pnpm test:contracts`) is **green** as of 2026-07-30 — **no known flakes** (the one 429-timing
blip is fixed, see §5), now a 24-link chain including the new `check:text` + `check:auth`.
Everything
through the Full Press functionality batch, BeigeBoard's editorial pass and the BB rebuild
(Waves A–D) is **committed and pushed to `staging`** (`f64c1ca`, merged to `main` as `d29bfcc`).

Section numbering is stable: **§1 = LazurOS**, **§2 = PapyrOS** (other docs cross-reference these,
and the `6.5e` label). **§3 = the media primitive program**. **§7 = Full Press** (the design
reface). **VaultOS moved out** → [VAULTOS.md](VAULTOS.md) (parked; ZFS covers the need).

**§1's sub-letters (1a–1f) are cited by [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) — keep the
lettering stable even as items close out; don't renumber.**

---

## ⚠️ Hard constraints a cold agent MUST know

- **Do NOT edit `apps/sylibos/`** — even in suite-wide sweeps. `bb`→`beigeboard`
  canonicalization never touches `sylib` spellings.
- **Suite scope** = BeigeBoard · jkAuth · jkDeploy · ORDECK · Weave · LazurOS · PapyrOS ·
  KourOS (the music app).
- **The gate must stay green after every chunk:** `pnpm test:contracts`. The full
  command/gotcha catalog is [PRIMITIVES.md](PRIMITIVES.md) (pnpm-copy staleness, ORDECK
  build+preview not dev, nginx restart-not-reload, root Docker context, quoted repo path).
- `Documentation/` is the source of truth; when a doc disagrees with code, the code wins —
  update the doc.

---

## Done so far (summary — full detail in the linked docs)

- **7-wave testing/upgrade program**, **LazurOS Phases 0–6+8** (Node/Weave async AI gateway,
  incl. the staging console at `/LazurOS` + edge-prefix fix), **PapyrOS Waves 1–7.3**
  (scanner/streaming/metadata/PWA/offline), the **`@jkos/player` primitive** (Waves 15–17+20)
  extracted from PapyrOS with zero behavior change, and **KourOS** (Wave 18, the music app —
  second player consumer, gapless/crossfade backend, playlists) are all built, gated, and
  **committed** (`efcd32c` and earlier). Architecture record:
  [ARCHITECTURE.md](ARCHITECTURE.md). Player design record: [PLAYER_PARITY.md](PLAYER_PARITY.md).
- **The design factory + `/design` reference page** (soft-corner suite default, wells/badges,
  compare slider, responsive breakpoints) — committed (`be7837b` and earlier).
  [DESIGN.md](DESIGN.md).
- **Full Press** (Waves 22–26, the design-system reface — Fraunces serif / Plex Mono / Big
  Shoulders seg): the functionality batch (press.css folded into hub.css, `@jkos/ui` re-cut,
  motion vocabulary) plus a **BeigeBoard deep editorial pass** (masthead folio, printed nav,
  rules ladder, colophon) — committed (`55671a3`, `3b98302`). [DESIGN.md](DESIGN.md) §§4–13.
  Remaining Full Press work: §7 below.
- **Tech-debt sweep** (2026-07-30, `9c06267` · `49b8e1f` · `7c834a3`). Dead code deleted
  (BeigeBoard's orphaned `lib/plan.ts`, the `WV_ROW_H`/`WV_LABEL_W` shims that had no importers,
  `Plate`/`ColorPicker`, three smaller symbols, dead CSS); the three copies of the auth state
  machine folded onto `@jkos/auth-client`'s `useAuthProvider`; a raw NUL byte removed from
  papyros's `format.ts`, which had made the file **binary to git and grep** and therefore
  invisible to every text-scan gate; the gate's one known flake fixed; `pnpm typecheck` made to
  actually cover the workspace (6 → 10 tasks) and the seven fake `lint` aliases dropped; a
  swallowed preferences-blob parse failure in jkAuth surfaced. Two new gates —
  **`check:text`** and **`check:auth`** (chain is now 24 links). Docs reconciled against code:
  21 dead markdown links → 0, and landed work that the backlog still described as open was
  verified and ticked. What was found but deliberately left is logged in §5.

---

## 1. LazurOS go-live

Built, tested, committed; nothing is mid-edit. Bring-up runbook:
[LAZUROS_STARTUP.md](LAZUROS_STARTUP.md). Architecture:
[ARCHITECTURE.md § LazurOS](ARCHITECTURE.md#lazuros-the-ai-gateway).

**LazurOS constraints:** no hardware facts in code (model tags, IPs, MACs, quantizations live
in a mounted `deployment.json`, never literals); every swappable piece is a
`createXProvider(config)` factory; prompts/model tags load from node-local
`prompts.json` / `models.json`, never inline strings.

### 1a. Internal code changes — DONE 2026-07-13, committed

All four landed; record folded into
[ARCHITECTURE.md § LazurOS](ARCHITECTURE.md#lazuros-the-ai-gateway) (Gate hardening): the
19-assertion Python worker smoke rides the gate; both `deployment.example.json` and
`deployment.jag.json` validate under test; the `jobs` dataset declares **and** enforces
`capability` + `since`; worker.py's dangling `LAZUROS.md` citations repointed. Nothing open
here. (The follow-up this entry used to carry — "check whether LAZUROS_STARTUP.md's *Known code
gaps* section is stale" — is discharged: verified 2026-07-30, that section already reads
"**CLOSED**".)

### 1b. Unblockers needing Jag (content + hardware, not code) — still open

| Item | Blocks | Notes |
|------|--------|-------|
| **`prompts.json` content** | live e2e of everything | **Top unblocker.** Node-local, per worker. Placeholders are **not free** — they must match the capability's declared body fields in `backend/docs.js`: `parse-task`→`{text}`, `breakdown-goal`→`{goal_text}`, `parse-document`→`{content}`, `widget-generate`→`{description}`, `query`→`{text}`. See the import-shape constraint below. |
| **`models.json` content** | any worker start | Node-local, flat `{capability: model-tag}`. Template ships with literal `REPLACE_WITH_*` values; `worker.py` raises on a missing capability. |
| Emily static IP + MAC | Phase 5 | Fill **3 placeholders** — `TODO_EMILY_MAC` ×1, `TODO_EMILY_IP` ×2 — in `apps/lazuros/deployment.jag.json` (confirmed still unfilled), then `cp` to `deployment.json` (gitignored, bind-mounted `:ro`). `computeBackend.js:34` hard-throws on a bad MAC, and a test asserts exactly that. DHCP reservation + WoL in BIOS **and** NIC + idle-shutdown. |
| Luna Ollama Vulkan confirm | Tier 0 | RX 560 is Polaris — ROCm dropped it, so **Vulkan, not ROCm**; pass `/dev/dri`. `ollama ps` must show the GPU. If it shows CPU, tier 0 is fake. |
| Whisper + Piper servers | Tier 0 STT/TTS | `:8000` (OpenAI-compatible `/v1/audio/transcriptions`) / `:5000`; source the GLaDOS Piper voice. |
| DDGS sidecar (or SearXNG) | Tier 1 | Provider ships both factories; Jag's config points at ddgs (`:8001`). **Tier 1 is web search, not Ollama.** |
| jkAuth env enrollment | delegated write-back | `JKOS_SERVICE_CLIENTS=lazuros:<secret>:beigeboard:write` **and** `JKOS_DELEGATION_CLIENTS=lazuros`. Both required — delegation supplies only the *who*; the client must separately hold the scope. Unset ⇒ write-back **silently cannot run**. |

**The import-shape constraint (load-bearing).** `parse-task` and `breakdown-goal` results feed
straight into BeigeBoard via `lib/writeback.js` → `POST beigeboard/import`, which does a bare
`JSON.parse` and throws on anything else. BB's importer requires `{items:[…]}` (or a bare array),
each item needing a `title`; children nest via `children`/`kids`/`subtasks` and **must be a
non-empty array** — an explicit `children: []` reads as a leaf task, not an empty goal. So the
`breakdown-goal` prompt must emit nested children and must never emit `children: []`.

### 1c. Phase 5 — Tier 2 wiring *(no code, blocked on 1b)*

Fill Emily's MAC/IP, verify `wake → probe → claim → round-trip` through the existing
`createWolBackend`. Full state walk: `PENDING → PENDING_WAKEUP → IN_PROGRESS → DONE|FAILED`.

### 1d. Phase 7 — BeigeBoard AI, rebuilt on LazurOS `[opus]` — not started

The old synchronous `/api/chat` surface was deleted in the 2026-07-13 cleanup, so this is
**new work, not a migration**, and it still needs a design pass:

- **The shapes are incompatible.** The old path was synchronous (POST → parsed JSON inline).
  LazurOS is asynchronous (`202 {job_id}` → poll the `jobs` dataset). So BB's AI has to grow
  **job-polling UX** (pending state, progress, failure surface). **Nobody has designed this.**
- **The write is LazurOS's, not BB's.** A `parse-task` job commits through delegated write-back
  into BB's existing `createItem` / `importItems` as the acting user. BB does not call a model
  and does not need an AI capability of its own — which is why `discovery.js` declares none.
- **Do this AFTER the staging console proves the round-trip** (§1f is live — use it to prove
  Phases 5 + 1b first).

### 1e. Phase 8 — ORDECK widgets — DONE, awaiting Jag's publish click

`apps/lazuros/widgets/lazuros-query.json` + `lazuros-jobs.json` + `README.md` with the exact
Workshop publish steps. **Remaining work = a human clicking Publish twice in the Workshop as
admin.**

### 1f. The staging test console + the edge-prefix fix — DONE 2026-07-13, committed

`https://staging.jkos.net/LazurOS` — admin-gated, lists capabilities derived from
`/api/lazuros/capabilities`, submits one, polls the `jobs` dataset. This is the surface to
prove Phases 5 + 1b on before starting §1d.

---

## 2. PapyrOS remaining

**PapyrOS** (`papyros`, port 3010): fully-native multi-user audiobook app. Never a client of
Audiobookshelf. Architecture: [ARCHITECTURE.md § PapyrOS](ARCHITECTURE.md#papyros-the-audiobook-app).

**Execution rules.** Waves run in order. The gate (`pnpm test:contracts`) must be green after
every wave; the app must also `pnpm --filter @jkos/papyros build` clean. Tasks are sized for one
sub-agent pass — sonnet by default; `[opus]` where flagged. New-app/wave crib (scaffolder,
CommonJS backend rule, weave dataset conventions, library path gotcha) lives in
[PRIMITIVES.md](PRIMITIVES.md) — read it before starting any item below.

### PapyrOS — open items

- [ ] **6.2 Live verify (needs Jag's own login).** Already confirmed via direct host access:
      boot scan cataloged 18 real titles, `/health`/`/api/capabilities`/`/api/datasets` shapes
      correct, `/papyros/` routes live behind the staging edge gate. Still needs a real
      authenticated session (no service token substitutes for "two independent users"): jkAuth
      login → `Range: bytes=0-1023` → `206`; two users → independent resume; match one
      thin-metadata book; add a bookmark; download a file; install the PWA. Then
      `pnpm prove --live https://staging.jkos.net --token <admin jwt>` for a clean signal,
      suite-health, and promote (prod blocked on DNS).
- [ ] **6.5e Multi-source metadata `[FEAT-P]`.** Jag approved **Open Library + Audible/Audnexus
      + iTunes**, all keyless: provider registry, merged/deduped candidates with per-source
      badges, field precedence (narrator/series/chapters = audnexus; description = audnexus > OL
      > itunes; genres = union; cover = audnexus > itunes600 > OL-L), cross-source agreement
      boosts auto-apply confidence. **NOT BUILT** — the spec is complete and ready. Single-source
      iTunes enrichment meanwhile runs automatically (`PAPYROS_AUTO_ENRICH=1`). Unblocked:
      `defineConnector.call()` landed (§3 17.6) — new provider connectors compose through the
      same `call()` surface.
- [ ] **7.2 Offline write queue `[FEAT-P]` `[opus]`.** Queue progress/bookmark writes while
      offline; reconcile on reconnect via the collections' `?since=` delta cursor,
      last-write-wins on `updated_at`. **`@jkos/player/services` already ships this
      (§3 Wave 16.5)** — check whether PapyrOS's own `src/offline/index.ts` seam still needs it
      or the shared brick already covers it before scoping new work.
- [ ] **8.1 Book club `[FEAT-P]`.** Club views over `clubs`/`club_members` + `progress`:
      current pick, members, who's-caught-up. Needs a bespoke membership-gated read route —
      scoped collections hide other users' rows. Ship the four default fields
      (name/description/current-pick/members).
- [ ] **8.2 ORDECK "continue listening" widget `[FEAT-P]`.** A published WidgetSpec via the
      Workshop reading `weaveClient('papyros')` books + progress — no ORDECK code changes (same
      pattern as LazurOS's widgets, §1e).
- [ ] **8.3 Parked polish** (record only, build on request): SSE/WebSocket "now listening",
      LazurOS auto-match, speed presets, bookmark export.

---

## 3. Media primitive program — `@jkos/player`

Design spec: [PLAYER_PARITY.md](PLAYER_PARITY.md). Waves 15–18+20 are **done and committed**
(engine extraction, services, UI kit, KourOS as consumer #2, gapless/crossfade backend). One
known micro-race in the gapless swap handshake is noted-not-fixed (self-heals; needs an ms-scale
race AND duplicate track ids in one queue — see PLAYER_PARITY.md §3).

### Wave 19 — video `[PARKED]`

Seams only for now — `htmlMedia` already covers `<video>`, `videoPlayer()` adds fullscreen, PiP,
subtitle + audio-track pickers, quality picker. **The real cost is the backend:** HLS segmenting
+ ABR ladder + seek-during-transcode, subtitle extraction (embedded + external, forced/SDH),
multiple audio tracks, VAAPI/NVENC hardware accel, thumbnail/BIF sprites. **Do not start without
a scoping pass** — this is easily larger than Waves 15–18 combined.

### Program unblockers (Jag — decisions, not code)

| Decision | Blocks | Default if unspecified |
|---|---|---|
| **`MUSIC_DIR` mount** (env value + compose volume bind, both compose files) | KourOS seeing real music | none — a NAS path is deliberately never hardcoded (mind the nested-`Luna` SMB trap, §2 crib in PRIMITIVES.md); scanner degrades to a 0-track no-op when unset |
| DNS `papyros.jkos.net` / `kouros.jkos.net` | prod promotes only | staging path-based works without |
| Audnexus as a second metadata provider | §2 6.5e | yes, keyless, as another connector spec |
| Book-club fields beyond name/description/current-pick/members | §2 8.1 | ship the four |

---

## 4. Decisions parked for Jag (deferred by design, with rationale)

Each was consciously stopped, not forgotten — pick any up by choice, none is blocking.

- **BB items onto `defineCollection`.** Schema is single-sourced in `src/item-fields.js`; full
  adoption was stopped because items carry lazy seed, recursive cascade delete, parent cycle
  checks, and three calendar sources the collection factory can't host as hooks without
  contortion.
- **Generate hub.css's dark block from `buildTheme`.** `tokens-parity` structurally closes the
  paper/dark drift surface; generation would add byte-identical-output risk (visual regressions)
  for low marginal benefit.
- **Prod edge gate for the portal.** The ORDECK SPA self-gates (AuthGuard → Google SSO) like
  every prod origin. A staging-style `auth_request` at the prod edge would diverge from that
  pattern — do it deliberately or not at all.
- **iCloud `ical.js` swap.** The hand-rolled parser ignores TZID and doesn't expand RRULE — both
  documented in `src/calendar/icloud.js` and PINNED by `calendar.sandbox.mjs`. A real `ical.js`
  provider drops in behind the same `CalendarProvider` contract; it's a new dependency, so Jag's
  call.
- **Design-primitive proposals P1–P9** from the 2026-07-01 visual-unification audit — awaiting
  review.
- **VaultOS** — parked entirely; ZFS covers the need. [VAULTOS.md](VAULTOS.md).

---

## 5. Smaller open items

- **ORDECK calendar-widget live verification.** `bb-week` renders read+light on the HUD;
  code-complete + gated. Remaining: on a running stack, add from the shelf, confirm real BB
  items render, grid drag doesn't clash with the view's internal layout, select is a clean
  no-op. Then note it in ARCHITECTURE.md and delete this line.
- ~~**jkAuth smoke flake.**~~ **FIXED 2026-07-30.** The 429-timing lockout assertion in
  `smoke.mjs` was one instance on a 500ms budget asserting both that an "immediate" retry is
  still locked *and*, after `sleep(700)`, that the window reopened. Under a loaded
  `test:contracts` chain the two adjacent requests could straddle 500ms, so the window had
  legitimately expired and the 429 never came — hence green in isolation, flaky in the chain.
  Now split into **E1** (60s window: the immediate-retry assertion can only break if a full
  minute passes between back-to-back calls) and **E2** (500ms window, asserted only *after*
  sleeping past it, where extra delay makes the window more expired, not less). Both halves are
  monotonic in elapsed time, so load can't flip either. Still 68/68; no assertion lost.
- **BeigeBoard mobile drill-down + bench.** `MobileTasksView` reads the same trees but lacks
  drill-in/breadcrumb + a compact bench rail ([PLANNING_METHOD.md](PLANNING_METHOD.md)
  § Follow-up). **Re-scope before starting:** this predates the Full Press rebuild, which
  *retired* the desktop drill-down and bench sidebar it was written against — so it now asks for
  mobile affordances the desktop no longer has. That's a design question for Jag, not a
  port.
- **Toolchain alignment.** `apps/sylibos` is React 19 + Tailwind v4 vs the suite's React 18 +
  plain CSS. Deferred until SylibOS re-enters scope (off-limits until then).

### Found by the 2026-07-30 tech-debt sweep — measured, deliberately NOT actioned

Three duplications/dead spots were located and quantified but left alone, each for a stated
reason. They are logged here so the measurement isn't lost; none is blocking.

- **ORDECK's HUD CSS carries ~37 dead classes.** `apps/ordeck/src/styles/hud.css` (988 lines)
  defines `hud-widget*`, `hud-today*`, `hud-task*`, `hud-systems*`, `hud-info*`, `hud-col`,
  `hud-grid`, `hud-now-chip`, `hud-streak`, `hud-study-*`, `hud-sys*`, `is-on`, and a subset of
  `hud-weather*` (`-now`/`-icon`/`-temp`/`-unit`/`-desc`) that nothing references — leftovers
  from the v2 hand-written widget markup that the v3 declarative WidgetSpec system replaced.
  Confirmed absent from TSX, JSON widget specs and dynamic-class construction. **Not deleted:**
  `registry.tsx` still uses the *sibling* weather classes (`-head`/`-hilo`/`-slot`), so this is a
  partial migration, and CSS deletion has no gate to catch a regression — it wants a browser
  open. ORDECK is also the app DESIGN.md flags as needing the most judgment.
- **`AuthGuard.tsx` is byte-identical (normalised) between PapyrOS and KourOS**, and the
  `.auth-veil` rules are duplicated in both `app.css`es. The auth *state machine* was
  consolidated (see `check:auth`), but sharing the component needs a new
  `@jkos/ui → @jkos/auth-client` dependency edge (or the reverse, which is worse) and moves
  `.auth-veil` into hub.css behind `check:design`. That's an architecture call, not cleanup.
- **`backend/src/routes/library.js` is 96% duplicated** between PapyrOS and KourOS — the
  `rescanLibrary` route differs only in header prose, one scope string (`papyros:admin` vs
  `kouros:admin`) and a log prefix. The subtle part is shared-by-copy: the admin gate checks
  `req.user.role === 'admin'` rather than a scope array *on purpose* (weaveAuth's dev stub
  injects no scope array), and KourOS's copy documents that only by pointing at PapyrOS's
  header — so a third consumer would copy again. **Not consolidated:** `@jkos/weave`
  deliberately has no `express` dependency (every existing brick returns handlers, never a
  `Router`), so a shared route brick means new API surface on a shared package plus touching a
  live auth gate on two backends, to remove ~20 lines. Worth doing *with* the next media-app
  wave, not as a drive-by.

---

## 6. After deploy (operational follow-through)

1. `pnpm prove --live https://staging.jkos.net` (+ `--token`) — health, docshape, directory,
   admin gate.
2. `node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>` — the write path
   through the real edge.
3. Set `BREAK_GLASS_TOKEN` in the controller's TrueNAS-side env (`openssl rand -hex 32`) and
   confirm `bash jkos-deploy/scripts/selftest.sh` passes on the host.
4. Confirm `CALENDAR_ENC_KEY` is set in the real BB `.env` (both prod + staging) before anyone
   connects a calendar — adding it later is safe, but earlier rows stay plaintext.

---

## 7. Full Press — the design-system reface

**The ask (Jag, 2026-07-19):** land the settled-and-loved **Full Press** design layer. Signature:
**humans read print (Fraunces), the machine speaks mono (Plex Mono), the tube emits
(Big Shoulders + halation).** Fence = [DESIGN.md](DESIGN.md) §13; ship discipline = §14.

The functionality batch (press.css folded into hub.css, `@jkos/ui` re-cut, motion vocabulary),
a full editorial pass for **BeigeBoard** (named the test bed, done first per Jag) and the BB
rebuild onto the prototype are **committed and pushed** (`55671a3`, `3b98302`, `f64c1ca`).

### Open — the rest of the per-app roster

Jag's ordering (2026-07-19): BeigeBoard first (done) → **jkAuth → PapyrOS → KourOS → ORDECK**.
Those four currently have only the **surgical** Wave-25 pass (redundant `fonts.serif` dropped,
`.muted` swept, `ink-in` on the view boundary) — none has had BB's deeper editorial treatment
(masthead/folio conventions, rules ladder, printed nav voice, per-app composition judgment
calls). Whether that deeper pass is still wanted for each app, and in what order, is Jag's call —
nothing is currently blocking or scheduled.

- [x] **BeigeBoard rebuild → the interactive prototype** (Jag 2026-07-20) — view-layer redesign +
      the **solid-ink chip system, now the suite-wide default**. Waves A–D shipped as `f64c1ca`
      (merged to `main` as `d29bfcc`): `jk-chip*`/`jk-press-ink|rev` in hub.css, `cardSurface()`
      re-cut, BB's 4 desktop views rebuilt, ORDECK inherits the kit reskin. Desktop only. Work
      order: [BEIGEBOARD_FULL_PRESS.md](BEIGEBOARD_FULL_PRESS.md).
- [ ] **BeigeBoard design parity — the fidelity pass** (2026-07-29; **status corrected
      2026-07-30**) — sequenced **P0b → P0 → P1 → P2 → P3** in
      [BEIGEBOARD_PARITY.md](BEIGEBOARD_PARITY.md).
      **P0b (all twelve primitives) and P0.1–P0.3 are DONE** — they shipped in `963e744` /
      `9cf5dba` / `4fffb23` but were never ticked, so this entry described them as open and
      **all five of its original "causes" are now fixed**: the hour row is `rowHeight` 60 (not
      48), gridlines paint `--hub-line`, `<ChromeBar>` is in Week *and* Calendar, `MO_DELAYS`
      exists, `.bb-hit`/`.bb-scroll` are gone in favour of real `.jk-hit`/`.jk-scroll`, and the
      gutter speaks mono. Two drafting details resolved differently than written: the meter token
      shipped as **`--bar-deepen-ink`** (the name `--accent-deepen-ink` was already taken by the
      accent chain, at a different value), and the deprecated `WV_ROW_H`/`WV_LABEL_W` shims were
      **deleted** — they had no importers.
      **What actually remains: P0.4** (the kit still spells nav buttons `.jk-cards-btn`, not
      `.jk-tbtn`) **then P1–P3**, the per-view visual literals — those need the prototype
      side-by-side in a browser and have **not** been audited. PARITY.md's *Corrections* section
      still stands, incl. that new hub.css classes **fail `check:design`** until
      `design-template.html` demos them.
- [ ] **jkAuth deep pass** — the letterpress form is the next natural candidate (small surface,
      login + portal dashboard).
- [ ] **PapyrOS deep pass**
- [ ] **KourOS deep pass**
- [ ] **ORDECK deep pass** — bespoke reel-spin/ticker chrome means this one needs the most
      judgment about what "printed" even means on a HUD.

### Wave 26 — harden & sign off

- [x] Docs freeze + gates green (done 2026-07-19).
- [ ] **26.1 Both-face visual QA** (paper+dark × 5 accent slots × 3 tiers) — needs a browser;
      ride Jag's next staging session, `/design` + each app. **The jkAuth image must rebuild**
      for `/design` + the login reface to go live — this is the immediate next unblock.
- [ ] **26.2 A11y spot-check.** Contrast is untouched by the reface (font faces changed, colours
      didn't) except `.jk-bubble-primary`'s lighter letterpress text-shadow — eyeball it on
      ice·coral (the stress slot). Reduced-motion + tap floors are already gate-pinned.
- [ ] **26.3 Font perf.** Google Fonts links already subset by weight + `display=swap`; Big
      Shoulders stays seg-surface-only. A self-host/subset pass remains available if FOUT on
      Fraunces bothers.
