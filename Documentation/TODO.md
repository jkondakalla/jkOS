# jkOS — TODO

**One place for everything still open.** Assembled 2026-09-09 by walking `RESET.md`,
`BACKLOG.md`, `ALGORITHMS.md`, `WEAVE.md`, `DESIGN.md`, `LAZUROS_STARTUP.md`,
`KOUROS_ANDROID.md`, `infra/backup/README.md` and the code — because the open work had ended
up spread across nine documents and a `targets: []`, and nobody could answer "what is left"
without reading all of them.

**How to use it.** This file is the *what*. The *why* stays where it was argued and is linked
per item — moving the reasoning here would strand it from the code it explains. Where this and
another doc disagree, `RESET.md` wins on intent and **the code wins on fact**.

⚠️ **One list, on purpose.** If you close something, close it *here*. The failure this file
exists to prevent is two lists of open work drifting apart — the same defect class as a gate
reporting on files it never read. `BACKLOG.md`'s "Open — …" sections now point here rather
than restating.

⚠️ **Nothing is carried on the strength of a checkbox.** Every item below was confirmed still
open against the source on 2026-09-09.

---

## 0 · Jag's — nobody else can do these

These block other work, and they are first for that reason.

- **The two off-box backup commands** — one writes the NAS's `authorized_keys`, one sets a
  passphrase only he should know. Both in [`infra/backup/README.md`](../infra/backup/README.md).
  ⚠️ **Before deploying anything that migrates a live database**, which is now everything on
  `staging`. For an audit portfolio, recoverability is part of the deliverable. (`RESET.md` §2a)
- **Generate the service-client secrets.** `JKOS_SERVICE_CLIENTS` and `JKOS_DELEGATION_CLIENTS`
  in [`apps/jkauth/.env.example`](../apps/jkauth/.env.example), `JKOS_SERVICE_CLIENT_ID`/`_SECRET`
  in LazurOS's. `openssl rand -hex 32`; grant `beigeboard:create`, not `beigeboard:write`.
  ⚠️ An id or secret containing `:` or `,` makes jkAuth refuse to boot — deliberately.
  The code half of D11 is done: LazurOS refuses to start in production without them.
- **Rotate the Qobuz credential at Qobuz.** The value was removed from the working tree on
  2026-08-27 but is reachable in history at `e3c829a` in every clone and on the remote.
  ⚠️ **Rotation is the only remedy** — history rewriting stays refused (destructive, coordinates
  with GitHub, Jag's call).
- ✅ **The music backfill — RESUMED 2026-09-16** (Jag: "build and start full run"), and the whole
  owed sequence with it: `music/analyze.py` runs vectors → descriptors + meshes → fit → gate →
  ship. ⚠️ **Read `RESET.md` §0a before touching `music/`** — the four named files still silently
  invalidate every banked vector.
- **Music analysis delivery — steps 1 and 3 of
  [`infra/music-analysis/README.md`](../infra/music-analysis/README.md)**: create the
  `Luna/jkos-analysis` dataset (⚠️ **before** the next deploy, or Docker creates it root-owned),
  then authorise the delivery key under `rrsync -wo -no-del`. Step 2 (`install.sh`) starts the
  watcher on the workstation. Until then the watcher's snapshots stop at `music/out/`.
- **Two zero-byte FLACs** need re-downloading. Not a code defect.
- **LazurOS's two unresolved hardware facts.** `TODO_EMILY_MAC` and `TODO_EMILY_IP` in
  [`apps/lazuros/deployment.jag.json`](../apps/lazuros/deployment.jag.json). The WoL backend
  rejects the placeholder by design, and there is a test asserting it does.
- **The Android keystore.** `infra/nginx/assetlinks.json` carries `"targets": []` — honest, and
  link verification simply fails until a real SHA-256 fingerprint is added. Needs JDK 17 + the
  Android SDK and a keystore **that must not be lost**. (`KOUROS_ANDROID.md`)
- **Retire SylibOS on the NAS.** Removed from the repo 2026-09-16 (Jag: "It is dead"), and the repo
  is the only thing that changed. Still live until you retire them: the `sylibos-frontend` /
  `sylibos-api` containers (prod) and `staging-sylibos-*` (staging) — `docker compose` without
  `--remove-orphans` leaves them running after the include is gone; the data directories
  `/mnt/Luna/Backends/{Production,Staging}/sylibos-data`; and the `sylibos.jkos.net` DNS record.
  ⚠️ **Deploying `staging` removes their nginx routes and jkAuth's registry row (migration 021)** —
  so the containers become unreachable, not stopped. Whether to keep the data directory is yours.
- **Deploy / promote — always a button Jag presses.**

---

## 0b · Decisions Jag owes — the cheapest things to unblock

**These are DECISIONS, not actions.** Everything in §0 above needs Jag's hands; everything here
needs only his answer, and each one is holding up work an agent could otherwise do alone.
Assembled 2026-09-10 with the measurements each one turns on, so none of them has to be decided
in the abstract. **Answer them in place** — this stays the one list.

### D1 · jkAuth: where does the capability doc come from? — §5

✅ **ANSWERED 2026-09-16 — (a), the generated manifest in `@jkos/suite-manifest`, gated.** The
build-time cost below is accepted: a new scope is a deploy-shaped event.

The single largest blocked item. C4 made the grant expressible per verb; what is left is jkAuth
deriving the *grantable set* from each app's capability doc instead of the registry row.

**Measured:** all four peer apps already export their docs as importable modules — the prober's
`BACKEND_DOCS` imports them today. The only real obstacle is that jkAuth's image does not carry
their source (`apps/jkauth/Dockerfile` copies peers' `package.json` and nothing else), and jkAuth
already depends on `@jkos/suite-manifest`.

- **(a) A generated manifest inside `@jkos/suite-manifest`, gated.** ⭐ *Recommended.* A build
  step emits the combined doc; jkAuth gets it in its image for free. Exact precedent:
  `apps/jkauth/public/jkos-tokens.css` is a checked-in generated mirror held by `check:tokens`.
  ⚠️ **Its cost, stated:** the grantable set becomes BUILD-TIME, so an app that changes its
  capabilities needs jkAuth redeployed to widen a grant. That is arguably correct — a new scope
  is a deploy-shaped event — but it is a real constraint, not a free win.
- **(b) `COPY` the four `discovery.js` files into jkAuth's image.** Smallest diff; couples every
  app's layout to jkAuth's Dockerfile, and nothing gates the coupling.
- **(c) HTTP fetch at boot, with a cached fallback.** ⚠️ Peers may be down at boot, so this needs
  a staleness policy and a cold-start answer — two new failure modes for one read.

### D2 · Stage F naming — the tier prefixes, and what replaces the pigments — §7

✅ **ANSWERED 2026-09-16 — D2a (a) keep `--hub-*` / `--color-*` / `--jk-*` as tiers 1 / 2 / 3, and
D2b (a) role names (`--ink-*`, `--ground-*`, `--accent`).** Stage F is licensed to start.

Step zero is done (`check:token-identity`), so the restructure is now safe to attempt. It cannot
start without these two names, and everything after them depends on them.

**D2a — the tier prefixes.** `RESET.md` already characterises the three tiers: tier 1 raw
per-face, tier 2 semantic aliases whose referent moves, tier 3 face-invariant geometry. Undecided
is what they are CALLED, given the prefix must carry the tier and only tier 1 gets a dark block.

- **(a) Keep the three prefixes that already exist and finish the job** — `--hub-*` = tier 1,
  `--color-*` = tier 2, `--jk-*` = tier 3. ⭐ *Recommended:* smallest honest diff, and they
  already roughly map. The work is moving the tier-3 tokens currently spelled `--hub-*`.
- **(b) Name the job** — `--ink-*` / `--role-*` / `--form-*`. Reads better cold; renames all 152.
- **(c) Name the number** — `--t1-*` / `--t2-*` / `--t3-*`. Unambiguous, and ugly forever.

**D2b — what replaces the pigment names.** "Nothing in the token layer should name a colour it
might not be" is decided; the replacement is not.
⚠️ **Measured blast radius: 927 occurrences across 48 files** on 2026-09-10 — one of which was
`apps/sylibos/`, since removed (2026-09-16), so re-measure before the rename rather than trusting
the number. ⚠️ **`music/ridge.py` and
`apps/kouros/src/components/Pulsarmap.tsx` both depend on this pair of faces** — ridge copies the
VALUES as literals, Pulsarmap aliases the NAMES — so both move with it.

- **(a) Role names** — `--ink-strong|mid|weak|faint`, `--ground-0..3`, `--accent`. ⭐ *Recommended.*
- **(b) Keep the pigments as tier-1 raws and only forbid them ABOVE tier 1.** Cheapest by far;
  concedes the stated principle.

### D3 · The 2,731-line jkAuth token mirror — build artifact, or a build step? — §7

✅ **ANSWERED 2026-09-16 — (a), it stays a checked-in generated artifact gated by `check:tokens`.**

Already framed in §7; it becomes live the moment Stage F starts, because every structural change
is then a change to two files.

- **(a) Keep it a checked-in generated artifact, gated by `check:tokens`.** ⭐ *Recommended:*
  Stage F is exactly when a build step is most tempting and least necessary — the gate already
  makes the mirror safe, and giving the one statically-served app a build step during a
  2,700-line restructure compounds two risks that are individually fine.
- **(b) Give jkAuth a build step.** One source of truth; jkAuth stops being statically served,
  which is the property the mirror exists to preserve.

### D4 · `check:audit` — raise the floor when, and may an agent bump versions? — §6

✅ **ANSWERED 2026-09-16 — (a).** An agent may change versions in `pnpm-lock.yaml` to clear the HIGH
advisories, and raises the floor to `high` only if the upgrades land green.

**Measured 2026-09-10: 7 packages carry HIGH advisories** (brace-expansion, browserslist, nanoid,
pdfjs-dist, postcss, react-router, vite) — up from 6 on 2026-08-27, so the count is drifting the
wrong way on its own. All are reached through build/dev dependencies, none through a deployed
container. The real sub-question is the one that unblocks an agent: **may it change versions in
`pnpm-lock.yaml`?** That touches every app's build.

- **(a) Let an agent attempt the upgrades, and raise the floor to `high` iff they land green.**
  ⭐ *Recommended* — it is the only option that converges, and it fails safe: if they do not land
  clean, nothing changes and the floor stays where it is.
- **(b) Raise the floor now and accept a red gate** until the upgrades land. ⚠️ §6's own warning:
  a red gate nobody can turn green is one people learn to skip.
- **(c) Leave both alone; re-read the count on a date.**

### D5 · The pulsarmap fill — what drives it, and may an agent spend the machine time? — §2 block 4

✅ **ANSWERED 2026-09-16 — (c), and the cost that made (c) expensive is gone.** Jag: "prep the full
KourOS analyze sequence, include meshes for the pulsar map", and yes to spending the machine time.
Meshes are built for the whole library as a stage of `music/analyze.py`, **in the same decode and
FFT as the descriptors** (`descriptors.describe_with_logmel`, held bit-identical to
`mel.logmelspectrogram`), so the 19.5 h measured below was the cost of reading every file a second
time, and is not paid. After the full run, the watcher meshes what lands on the shelf.

⚠️ **Measured 2026-09-10: 1.48 s/track**, so a full-library fill is **~19.5 hours**
single-threaded and about **790 MB** of `meshes.db` to ship. That is what makes §2's "built on
demand and cached, never batched across all 47,441" a real constraint rather than a preference —
and it contends with the paused backfill for the same CIFS mount (Trap 19 plateaus at 3 readers).
`--pending` is built and works; what it should be POINTED at is the open question.

- **(a) KourOS's `history` table** — mesh what has actually been played. ⭐ *Recommended:*
  self-limiting, and it matches the decided "on demand and cached". Needs the fill run to be able
  to read KourOS's database, which is on the NAS.
- **(b) Top-N most played, or the N most recently added.** No cross-database read; arbitrary N.
- **(c) The whole library once** — 19.5 h and 790 MB, then never think about it again.
- **(d) Build `meshd.py` (block 4-ii) and fill nothing.** Makes "on demand" literally true; costs
  a LAN-only service.

**And separately: may an agent spend hours of machine time on a fill at all**, or is that a run
Jag starts himself alongside the backfill?

### D6 · `livePosition()` on `@jkos/player`'s `PlayerApi`? — §2 block 8

✅ **ANSWERED 2026-09-23 — yes, and BUILT, because it stopped being polish.** Jag: two-second rows
were "way too sparse … the pulsar frames should flow onto the screen at a pretty consistent rate so
that it can actually be a visualizer for the music." The mesh went to 0.093 s rows (~10.8 a second),
where `timeupdate`'s 250 ms is three rows, so `livePosition()` shipped with the flow (§2 item 11).

*As it stood:* Polish, and purely a taste call. Today the reveal is driven by `globalPos` — the media element's
own `currentTime`, published on `timeupdate` — so it can never drift, but a row can arrive up to
~250 ms late against a 2 s row. Making it literally per-frame is ~5 additive lines on a shared
package that PapyrOS and KourOS both use. **Recommend: yes, but last.**

### D7 · Where does the backup status get published? — §9

The local half is built (journal + desktop notification). The HUD half is blocked because the
backup runs on the **workstation** and every jkOS service runs on the **NAS**, so no backend can
see `last-run.txt`.

- **(a) Nothing further — the journal and the notification are the answer.** ⭐ *Recommended
  while there is no backup at all:* the person who needs to know is sitting at the workstation,
  and every other option adds a surface to watch a pipeline that has never succeeded.
- **(b) The script POSTs a status line to a suite endpoint** under a service client. ⚠️ Depends
  on §0's service-client secrets, and adds a declared write surface whose only writer is a shell
  script.
- **(c) The workstation copies `last-run.txt` to a path the edge serves**, and ORDECK's
  `useSystems` reads it. No new credential; a new file the NAS serves and nothing gates.

### D8 · BeigeBoard `/api/items` — page it, or record it as decided? — §6

The constraint is already settled ("page it by the cursor column or not at all") and the absence
is load-bearing for `bbDelta`'s merge. What is open is only whether it is worth doing.
**Recommend: move it to §10 as a decided exception** unless BB's item count is actually growing —
which needs a look at the production database, so it is a read Jag can do and an agent cannot.

### D10 · `--color-accent-contrast` fails AA on the paper face — which of three fixes? — §7

✅ **ANSWERED 2026-09-16 — (3), derive it from the resolved accent's luminance.**

**Measured 2026-09-10** against the live chain on the house default accent, so this does not have
to be decided in the abstract. `.btn-primary` is 16px/600 — not WCAG "large text", so the bar is
4.5:1:

| Text on `--color-accent` (paper, `#b27b05`) | Ratio | AA |
|---|---|---|
| today: `--color-accent-contrast` = `#ffffff` | **3.67:1** | ✗ |
| alternative: `--color-ink` = `#1c1408` | **4.96:1** | ✓ |

Paper deepens the raw accent toward ink *and* keeps white on top; the dark face doesn't have the
problem (it sets `#000000` over the undeepened accent). The token reaches jkAuth, KourOS, ORDECK,
and `@jkos/ui`'s `SettingsDrawer` — and `apps/kouros/src/glass.css` already hand-rolls
around it, which is a hint the token is under-specified rather than merely mis-set.

Three candidates, cheapest first: **(1)** flip paper's value to the ink ramp — one line, but
inverts every accent-filled surface at once; **(2)** deepen the paper accent until white clears
4.5:1 — changes the brand colour; **(3)** **derive it from the resolved accent's luminance**, so
it stays correct across all five presets *and* a user's custom pair.
**Recommend (3)** — the accent is user-selectable, so every static answer is wrong for somebody.
It is real design-pass work, which is why it is a decision and not already done. Full write-up:
[DESIGN.md §3](DESIGN.md), "Open decision".

*Not blocking:* the separate, far worse bug in the same area — a custom-property cycle that made
this button **invisible** at 1.19:1 — is **fixed** (`apps/jkauth/public/style.css`). This item is
only about the remaining 3.67 → 4.5 gap.

### D12 · The vibe space's gate: G7 restated, two fit rules replaced — confirm? — §3

✅ **ANSWERED 2026-09-23 — (a), all three confirmed by Jag.** G7 is slice-mix fidelity (≤ 0.02 of
the exact field, 48 slices); λ is the largest penalty within 0.01 of the best held-out Spearman; an
unnamed axis is oriented by the sign of Σ loading³.

Jag confirmed the pre-declared thresholds on 2026-09-16 and then left the run unattended, so three
things measured wrong after that were changed rather than waited on. Each is argued with its
numbers in `ALGORITHMS.md` §9 M6:

- **G7 restated.** As worded ("voxel change per 1/256 of the rail ≤ 2% of ρ_ref") it measured the
  data — the exact continuous field itself changes 7.05% — so it is now held as what it was for:
  the opacity mixed from two slices stays within 0.02 of the exact field. That measurement showed
  32 slices bowing 0.0193 off between slice centres; the field is now 48 slices (0.0073).
- **λ** is the largest penalty within 0.01 of the best held-out Spearman, not the argmax (the
  argmax swung `u` by cos 0.91 on a 90% refit).
- **An unnamed axis** is oriented by the sign of Σ loading³, not its largest loading (which turned
  e3 inside out, cos −0.998, when two loadings traded places).

- **(a) Confirm all three.** ⭐ *Recommended* — each is the same intent, measured.
- **(b) Send G7 back** to a different continuity criterion (it is the only one with a threshold
  that changed meaning).

### D9 · Scope for the next run

Confirm, so an agent does not have to guess:

- **Is Stage F its main job?** §10 puts the ORDECK redesign and the widget factory in the NEXT
  run; §7's restructure plus the factory manifest is presumably this one's.
- **Is LazurOS out of scope?** §4's ladder needs the workstation's GPU and a live Ollama, so an
  agent cannot start it — but L2 (prompt versioning, audit schema, eval harness) is code and
  could be built ahead of L1.
- **May an agent install systemd units / change machine state**, or does everything of that shape
  stop at "here is the installer, run it"? (§9 assumed the latter.)

---

## 1 · Deploy state — read this before planning anything

**Everything landed since 2026-08-26 is on `staging` and none of it is deployed.** Stages A–E,
the post-completion audit fixes (including the expired-OTP security fix), and the documentation
re-derivation. That unlanded set includes **database migrations across jkAuth, BeigeBoard,
KourOS and PapyrOS** — which is why the backup commands above are not housekeeping.

Also pending, and unrelated to the branch: **production DNS for PapyrOS and KourOS.** Both are
reachable on staging only (`staging.jkos.net/papyros/`, `/kouros/`).

---

## 2 · The pulsarmap (M7)

**Jag's, 2026-09-03 — a named feature, not decoration.** A track's mel spectrogram becomes a
lightweight mesh the browser pulls and reveals as the song plays: one ridgeline per ~2 s slice,
stacking toward the viewer. Reasoning and arithmetic in `ALGORITHMS.md` §9.

**Decided up front, so the blocks below don't re-ask:** a line is a **moment in time** (not a
frequency band — it makes the canvas append-only); and it is a **KourOS view behind a declared
read**, not a shared package. ~~Meshes are built on demand and cached, never batched across all
47,441 tracks~~ — **superseded 2026-09-16 by Jag (D5)**: the full analysis sequence meshes the
whole library, in the descriptor pass's decode.

1. ✅ **`music/mesh.py` — the builder. DONE 2026-09-10.** `(128, T) float32` → `(rows, 128)
   uint8`, 86 frames/row (1.997 s), quantised against `ridge.default_value_range()`, stamped with
   `config.signature()` and refused by the store if it drifts. `encoder.py` / `mel.py` /
   `config.py` / `audio.py` are untouched — RESET.md §0a holds.
2. ✅ **The reduction, measured. DONE 2026-09-10 — and the presumed answer was wrong.** `p75`,
   not `max`. `max` pins **44–70% of the sub-200 Hz cells** at the ceiling across M2's four
   reference tracks: it reports "something was loud in these two seconds", not "the bass is
   loud", which the stand-up cut proves by saturating 44% of a band it has no content in. Over a
   2 s row the beat is below the picture's own sampling rate, so the reduction's job is to
   describe a window, not catch a transient. Table and reasoning in `ALGORITHMS.md` §9;
   `python mesh.py --compare <file>` reproduces it.
3. ✅ **`music/meshes.db` — the sidecar store. DONE 2026-09-10.** Separate file, `VACUUM INTO`
   snapshots, root-relative lowercased keys matching `relKeyFromEmbedderPath` in
   `apps/kouros/backend/src/discover/vectors.js` exactly.
4. **The fill trigger.** ✅ **(i) is built** — `python mesh.py --pending [N]`, one commit per mesh,
   failures recorded as data so "not built yet" stays distinguishable from "tried and could not".
   Its pending list is every indexed track, oldest first: the answer that needs no decision. **A
   policy goes in front of it when there is one** — KourOS's `history` table, a frontend
   wanted-list, or top-N most played — and none of the fill code changes when it does.
   ✅ **Closed 2026-09-16 without (ii).** The fill is a stage of `music/analyze.py` (whole
   library, sharing the descriptor decode — D5), and "on demand" became "on arrival": the
   watcher meshes what lands on the shelf and delivers it, and KourOS reopens a replaced store
   within its TTL. `meshd.py` would have bought request-time builds for tracks the watcher has
   not reached, which after the full run is none. The options as they stood:
   - **(ii) A LAN-only `music/meshd.py`** behind an internal bearer, called at request time — the
     LazurOS `/internal` precedent, stdlib `http.server`. Makes "on demand" literally true, and
     costs a service. ⚠️ Decide this against a real (i) run, not in the abstract.
   - **(iii) Python + numpy in KourOS's image — ⚠️ REJECTED.** It moves the transform into an app
     container and invites a second copy of the one artifact this project is built on.
5. ✅ **The KourOS read, DECLARED. DONE 2026-09-10.** `GET /api/discover/mesh/:id`, declared as
   `discoverMesh` in [`apps/kouros/backend/discovery.js`](../apps/kouros/backend/discovery.js)
   with its own entry (`98-surface-coverage` now reads 18 mounted / 18 declared). JSON with the
   rows base64 in an ordinary body. ⚠️ **The catalog side of the join is not the embedder side** —
   the embedder's path carries the library root as a segment, KourOS's is under a mount usually
   not named after it. `catalogRelKey` now lives in `vectors.js` beside
   `relKeyFromEmbedderPath` with both consumers on it; reaching for the wrong one resolves every
   lookup to null and reads as a fill that never ran (caught by the smoke, not by review).
6. ✅ **Mesh coverage joins `/discover/stats`. DONE 2026-09-10** — `meshes: { available, meshes,
   failed, recipe, source }`. Four states are kept apart end to end: `ok`, `pending` (200, the
   steady state during a fill), `failed`, and `unavailable` (no store at all).
7. ✅ **`<Pulsarmap/>` — the renderer. DONE 2026-09-10.** `apps/kouros/src/components/Pulsarmap.tsx`,
   rendered above the scrubber in `views/NowPlaying.tsx`. Canvas 2D, no WebGL, no new dependency;
   opaque fill then stroke, back to front, onto a full-track offscreen canvas with a panned
   window blitted at an 11 px pitch. Colours resolve `--kr-pulsar-*` off the element at runtime —
   plain aliases of `--hub-bg-0` / `--hub-cream-bright` / `--hub-cream-dim`, whose two faces are
   exactly the pair `ridge.py` measured, so there is no fifth palette and no dark block.
   ⚠️ **The row ramp encodes POSITION IN THE TRACK, not depth in the stack** — forced by the
   append-only draw (a row is painted once), and the right analogue anyway: `ridge.py` ramps
   across frequency because a line there is a band, and here a line is a moment.
   ✅ **Seen in a real browser, 2026-09-16.** The real component, bundled with only `../api`
   stubbed, fed the five REAL meshes in `music/meshes.db` in headless Chromium: first paint at
   0 s, mid-track and end-of-track opens, both faces (tokens resolve per face off the element).
   Every reveal plan was driven through React and **pixel-compared against a direct render of the
   same final state** — a live 0→30 s play (120 position updates, the append path), a seek
   backwards 300→30 s (repaint), a jump forwards 10→200 s, and a track change 3@200→4@20 (reset,
   no residue of the previous track). All four: **0 differing pixels**; a control pair differs by
   14,227, so the comparison is not trivially zero.
   ⚠️ **2026-09-16 — why staging showed nothing: no mesh store had ever been shipped.**
   `/mnt/Luna/Backends/Staging/kouros-data/` held no `music-meshes.db` (and no `music-index.db`),
   so `/api/discover/mesh/:id` answered `unavailable` — nginx logged 200s with a 60-byte body — and
   the component correctly rendered nothing. Shipped a **95-mesh** store there (both Mick Gordon
   DOOM albums, 90 tracks built in 141 s, plus the five `!!!` meshes) via `mesh.py --ship`, then an
   atomic rename; checksums match. KourOS re-opens an unavailable store every 5 min, so no restart.
   This is a deliberately small fill of what was being played, NOT a fill policy. *(D5 was answered later the same day — the whole library, via `music/analyze.py`; after the next deploy KourOS reads meshes from `/analysis`, not this file.)*
   ⚠️ A glob over album folders silently matches nothing: `[FLAC] [24B-48kHz]` is a character
   class. List the directory instead. Stills of the real component on this mesh:
   `Documentation/Images/kouros-pulsarmap-{paper,dark,dark-long-track}.png` (gitignored).
   ⚠️ **Still unseen: the `NowPlaying` mount itself** — `position` there is `p.globalPos` off a real
   media element, and the harness drove `position` directly. That is a one-line prop, but it is the
   half no scratch harness can reach; it is seen the first time the view is opened on a deploy with
   a mesh store mounted.
   ⚠️ *Harness trap, not a repo defect:* esbuild resolves `./pulsarmap` case-insensitively and picks
   `Pulsarmap.tsx` (its default order tries `.tsx` first); Vite and `tsc` try `.ts` first and are
   fine. A pixel count taken inside the page also races the component's `requestAnimationFrame`
   under `--virtual-time-budget` and reads blank — trust the screenshot, not an in-page counter.
8. ✅ **`revealIndex()` — pure, extracted, gated. DONE 2026-09-10.**
   `apps/kouros/src/components/pulsarmap.ts` + `pnpm check:pulsarmap` (`test/pulsarmap.mjs`,
   transpile-the-real-module). `planReveal` covers append / repaint-on-seek-backwards /
   reset-on-track-change, and **pause falls out rather than being special-cased** — a paused
   element's `currentTime` does not move, so a `paused` flag would be a second source of truth
   about whether time is passing. The gate asserts a whole track paints each row exactly once
   after one clear, and scans the module for `setInterval`/`Date.now`/`requestAnimationFrame`.
   ⚠️ **Driven by `globalPos`, which is the media element's own `currentTime` published on
   `timeupdate` — never a counter.** That is ~250 ms granular against 2 s rows, so a row can
   arrive slightly late but can never drift. Making it literally per-frame wants a
   `livePosition()` on `@jkos/player`'s `PlayerApi`; that is a change to a shared package for a
   sub-row gain and is Jag's call, not slipped in.
9. ✅ **Python tests. DONE 2026-09-10** — `music/tests/test_mesh.py`, 48 tests, stdlib
   `unittest`. Quantisation round-trips within half a step and clips at the ends rather than
   rescaling; the reduction is pinned to the measured `p75` and asserted not to be silently
   `mean`; the value scale is proved SHARED (two synthetic tracks 9 ln apart must produce meshes
   40 codes apart — a per-track normaliser makes them equal and nothing else does);
   `row_seconds` is asserted to MOVE when `config` moves, which a literal cannot do. The store's
   WAL trap is reproduced rather than described.

10. ✅ **The pulsarmap in 3-D. DONE 2026-09-16** (Jag: 3-D ridgelines, replacing the 2-D strip,
    camera following the playhead). `apps/kouros/src/components/ridges3d/` — one R8 texture, no
    vertex buffers, curtains + screen-space lines, a follow camera a drag orbits and a release
    springs home; the 2-D renderer stays whole as the no-WebGL2 fallback. `check:pulsarmap` grew by
    30 assertions (texture wrap round-trip, the shader's arithmetic scanned against `cellOf`, the
    no-normaliser scan, clamps, the solved spring). Seen in headless Chromium on five REAL meshes:
    live play, seek back, jump forward and track change each 0 px from a direct render; orbit and
    return pixel-identical; the fallback draws. Stills: `Documentation/Images/kouros-pulsarmap-3d-*.png`
    (gitignored). **Seen in the real Now Playing overlay too** (placeholder library, meshes built by
    `mesh.py`'s own builder, real playback in headless Chromium): the stack grows as the media clock
    moves (2 → 9 s), a paused track draws nothing new, and at a size where the rune layer is live a
    right flick ON the pulsar orbits it without skipping while the same flick on the title IS
    "next track" — the `[data-owns-pointer]` guard, proven both ways. Still: `…-3d-now-playing.png`.
    ⚠️ **Still unseen: a real phone** — frame cost on a mid-range GPU, and the feel under a thumb.
    ⚠️ **Found on the way, not caused by this and not fixed: Now Playing does not fit one screen on
    ANY common phone size**, so the rune layer always stands down on a phone. Measured on the
    placeholder library: 390×844 overflows by 165 px, 375×667 by 318, 412×915 by 91, 360×740 by 246.
    The 3-D strip is 32 px taller than the 2-D one and flips none of those (each still overflows
    without it). The runes are built and gated; on a phone they are currently unreachable.

11. ✅ **The pulsarmap FLOWS — a visualizer. DONE 2026-09-23** (Jag: "a frame every second or two …
    way too sparse to be anything useful"; chose ~10.8 rows/s at 128 bands, and to stop the running
    analysis and restart it on the new recipe). `mesh.ROW_SECONDS` is 0.1 (4 frames, 0.09288 s
    derived); the reduction was re-measured at 4 frames and stays `p75` (ALGORITHMS.md §9). The
    renderers are stateless per frame: the stack's position is `scrollRow(currentTime)`, read EVERY
    frame through `@jkos/player`'s new `livePosition()` (D6); the 3-D camera rides the playhead
    exactly; the 2-D fallback's whole-track canvas became a window redrawn per frame (at this rate
    a four-minute track would have been ~23,000 CSS px of canvas). Seen on REAL playback in Now
    Playing: 24 frames in 2 s each with a new focus, against 6 `timeupdate`s; paused, zero frames.
    Stills: `Documentation/Images/kouros-pulsarmap-flow-*.png` (gitignored).
    ⚠️ **Cost:** ~330 KB a four-minute track (~310 KB gzipped on the wire, was 20 KB) and ~15 GiB for
    the library store; the 2 s store is kept as `music/meshes-2s.db`. Phones with only WebGL2's
    guaranteed 2,048 texture size fall back to 2-D for tracks over ~50 minutes (`RidgeRenderer`
    asks for up to 4,096, which holds 3.4 h).
    ⚠️ **Still unseen: a real phone** — 60 fps with ~44 × 127 × 2 quads a frame on a mid-range GPU
    (headless swiftshader managed ~12 fps with the whole overlay), and whether the flow reads well
    under a thumb.
12. ✅ **The 3-D renderer is a suite primitive — `@jkos/scene`. DONE 2026-09-23** (Jag: "it should
    become a primitive so that other weave components can use the 3d renderer"). `useScene` (the
    canvas's life), an orbit rig and `useOrbitControls`, and pure math (`/math`: springs, picking,
    a matrix as a wrapped texture, OKLCH). Both KourOS views are on it, proven pixel-identical to
    the code before (99 headless shots, 0 px); `check:scene` holds every WebGL view to it. How to
    use it: `WEAVE.md` §4 Step 4 and obligation 33.

**What would make this wrong:** a second mel implementation; per-track normalisation at any of
the four points it could enter (builder, quantiser, renderer contrast, the 3-D shader's
`heightAt`); a streaming protocol (the mesh is ~20 KB — fetch it whole, reveal by index).

---

## 3 · Music — the rest of the vector space

- ✅ **What the resumed backfill owed is ONE command now — `music/analyze.py`** (2026-09-16):
  scan → vectors → baseline (descriptors + meshes, one decode) → fit → gate → ship → deliver.
  Every stage resumable, the gate refuses the ship, the snapshots are verified from the copy.
  `analyze.py --status` reads where each stage stands. The chain it replaces, for the record:
  `descriptors.py --build --encoded` → `query.py --fit` → `query.py --gate` → `ship.py`.
  ⚠️ **`--fit` is not optional.** It fits the corpus geometry into `meta`, and KourOS ranks on the
  *centred* space. Ship an unfitted index and every served cosine is raw — strangers at +0.48
  instead of −0.03, the two arms on incompatible scales, `makeRun` degenerating into an energy
  ramp through unrelated music, **and nothing errors**. `ship.py --check` refuses such an index.
  (`RESET.md` §0a)
- **M5 — walking shuffle.** Pick a start, repeatedly step to a nearby unplayed track, so
  consecutive tracks are similar and the set drifts. A **temperature parameter** dials album
  coherence ↔ real variety. This is the feature that justifies the pipeline. Joins KourOS's
  `tracks` by absolute path.
- ✅ **M6 — the vibe space. BUILT 2026-09-16.** Jag overrode "do not re-derive the projection" that
  day: the 2-D PCA map is replaced by a 3-D volumetric cloud swiped through ENERGY. The fit is
  `music/mapbasis.py` (energy probe + residual PCA, gated, stored in `meta`, held on failure), the
  projection and packed wire are `backend/src/discover/map.js` (basis verified at load against five
  golden tracks), the cloud is `src/components/vibespace/` (`check:vibespace`). Decision record and
  every measured number: `ALGORITHMS.md` §9 M6. Still owed:
  - **The G1–G4 numbers from the first real fit**, recorded in ALGORITHMS.md when `analyze.py`
    reaches its fit stage. ⚠️ The run started at 20:48 on 2026-09-16 imported its stages BEFORE
    `mapbasis.py` existed, so its own fit does not fit the basis: `mapbasis.py --fit` then
    `analyze.py --stages gate,ship` afterwards.
  - The renderer is on `@jkos/scene` since 2026-09-23 (§2 item 12) — behaviour pixel-identical.
  - ✅ **The real fit — DONE 2026-09-23 19:18.** After the 2026-09-16 run aborted on a dropped
    mount and a restart on the 0.1 s mesh recipe, `analyze.py` fitted, gated and shipped the whole
    library (6 h 39 m): **the FALLBACK basis ships** by the pre-declared policy — the primary fails
    G1 (0.571×); the fallback passes G1 1.000×, G2 +0.791, G3 0.111, G4 ≥ 0.9999. Downstream on the
    shipped index: G5 golden agreement 2.9e-8, G6 320 KB gzipped. Table in ALGORITHMS.md §9 M6.
    Seen on the real map in headless Chromium at w0 0.1 / 0.5 / 0.9, both faces — which showed the
    cloud sliced flat at a cube face, fixed the same day (`EDGE_FADE`, presentation only).
  - ⚠️ **Staging has the new INDEX, not the new MESHES — deliberately.** 2026-09-23 the shipped
    `music-index.db` went to `/mnt/Luna/Backends/Staging/kouros-data` (sha256 matched on both ends,
    atomic rename). The 0.1 s `music-meshes.db` (16 GB) did NOT: staging runs `b8f44e0`, whose 2-D
    renderer paints the whole track on one canvas — ~57,000 device px at 0.1 s rows, past the
    browser's limit, so it would have blanked the pulsarmap that works there today on 95 old
    meshes. The new meshes belong with the deploy of the new code, whose compose reads
    `/analysis/…` — which needs Jag's `Luna/jkos-analysis` dataset and delivery key
    (`infra/music-analysis/README.md`); until then the new code on staging would see no stores at
    all. Both snapshots are in `music/out/`.
  - ⚠️ **A flaky gate assertion, seen 2026-09-23 and not fixed:** `discover.smoke`'s "a lapsed TTL
    over an unchanged index does not rebuild" failed once (1 → 2 builds) inside `pnpm
    test:contracts` while `analyze.py` held every core, and passed alone and on the gate's rerun.
    Likely a race, not a defect: it counts `space built in` log lines across a 400 ms TTL, and a
    boot scan that finishes late under load legitimately rebuilds inside that window. Fix by
    waiting for the boot scan to settle (or keying on the build's cause) before taking the count.
  - **A real phone**: frame rate during a scrub, whether the adaptive render scale settles, and
    how the density worker's build time (1.5 s on the workstation for the gate's 3,000-track
    fixture) scales to 47,000 tracks on a phone CPU.
  - **The path the current shuffle is taking through it** — M5's walk as a ribbon through the
    cloud. Needs M5.
  - ✅ **Found on the way and FIXED 2026-09-16: KourOS's descriptor-arm fallback read the wrong
    space.** `vectors.js` `loadArm` L2-normalised the RAW 119-d blobs and centred them by
    `calib_mean:descriptors`, which `query.fit_calibration` fits in the z-scored space — so on that
    arm every cosine was, in effect, spectral centroid and rolloff. It now z-scores by
    `descriptor_mean`/`descriptor_std`, L2s, then centres, and refuses the calibration when the
    stats are missing. Cross-checked against `query.load_arm` + `Calibration.centre` on the REAL
    descriptors: 3e-8. `discover.smoke` §2c′ holds it (a mutation removing the z-score fails it).
    Reached only by an index with descriptors and no neural vectors; `mapbasis.ARMS` still maps
    the neural arm alone.

---

## 4 · LazurOS — the ladder

Code-complete, **never run live.** `LAZUROS_STARTUP.md` is the runbook and is verified against
source; do not re-derive it.

- **V — the completion-volume read.** Measured 2026-08-18: **zero completed items of any kind**
  in the staging DB, against 3 routine occurrences minted. The `completed` 0→1 edge has never
  fired in production, so migration 13's trigger is unproven live. **One real completion closes
  it.** ⚠️ Copy the `-wal` alongside the `.db` when reading that database, or you query a stale
  snapshot. Re-read this number before scheduling L3 — not before L1 or L2, which are unaffected.
- **L1 — minimal bring-up.** Ollama + the State node + jkAuth enrolment. Whisper, Piper and the
  DDGS sidecar are **cut from the critical path** — assistant features, not blockers.
  ⚠️ Tier 1 in the committed config *is* the web-search tier, so cutting the sidecar leaves it
  with no fulfiller. Fine for this path; note it when `query` escalates into it.
  ⚠️ `prompts.json` placeholders are not free — they must match the capability's declared body
  fields in [`apps/lazuros/backend/docs.js`](../apps/lazuros/backend/docs.js) exactly, or
  `template.format(**payload)` raises `KeyError` and the job goes `FAILED`.
  ⚠️ `ollama ps` must show the GPU. **If it shows CPU, tier 0 is fake.**
- **L2 — prompt versioning, an audit schema, and an eval harness.** First, not last. Gate: one
  capability has a reproducible score.
- **L3 — the variance feature.** Prescribed-vs-performed reconciliation: deterministic statistics
  **in SQL**, an LLM only for the proposal text, findings below the minimum-observations floor
  **suppressed rather than caveated**. ⚠️ **Gated on V** — with thin volume it is *deferred, not
  descoped*; step 0's logging keeps running.

---

## 5 · jkAuth

- ✅ **Capability-declared scopes — DONE 2026-09-16** (D1 answered: a generated manifest). The
  scopes each capability doc declares are generated into
  `packages/suite-manifest/scopes.generated.js` (`pnpm check:scopes` holds it fresh), and
  `grantableScopes(id)` derives the grant: `<id>:read`, what the app declares, and the
  create/update/delete ladder beneath a declared `<id>:write`. jkAuth's `roleClaims` mints only
  that — so `ordeck:delete`, `auth:admin`, `beigeboard:admin` and the rest of the undeclared
  ladder are no longer in anyone's token — and a service client configured with an undeclared
  scope (a typo, or a grant for an app with no writes) **refuses to boot**, naming the scope
  unless it could be a secret fragment.
  ⚠️ **Cost, accepted in D1:** a new scope is a jkAuth redeploy. ⚠️ **Found on the way:** three
  BeigeBoard write capabilities declared no scope at all; they declare `beigeboard:write` now,
  and the gate refuses the next one.
- **Two authorization policies.** `policy.js` holds the route actions; `roleClaims()` in `db.js`
  decides the `aud` and `scope` claims **every token in the suite carries** — a wider decision
  than any route guard. Folding it in means `policy.js` depending on `db.js` and owning a
  registry-derived cache: a change to the token-minting path. Pinned today as an exact
  three-comparison exception so it cannot grow a fourth unnoticed.

---

## 6 · Weave and the fabric — the owed halves

- ✅ **Dedup at the write door — DONE 2026-09-10.** `packages/weave/src/server/idempotency.js`.
  `defineCollection` declares `idempotency_key` on every `create*` capability and its POST route
  replays the first attempt's response for a repeated key (`Idempotent-Replay: true`) instead of
  writing a second row. One `weave_idempotency` table per app database, carried in by the
  collection DDL. The field name had two spellings — a constant in `capability.ts` and a literal
  in `trigger.js` — and now has one home in `shared/idempotency.js`.
  ⚠️ **Scoped by (door, USER), which is a security property**: a per-user delegated DO fans one
  trigger out to N users carrying the same derived key, and a global store would answer user B
  with user A's row, with a 200 and no error.
  ✅ **The hand-rolled doors — DONE 2026-09-16.** BeigeBoard's `createItem` and `importItems`, and
  LazurOS's five job doors, now dedup too; `check:rulings` holds the declaration on every `create*`,
  every async door and every write-back target. ⚠️ **It closed a live double-write:** a LazurOS job
  that outran the reaper's timeout finished twice and imported its tree into BeigeBoard twice.
  The write-back now keys on the job id. Three more defects in the shipped half, found on the way:
  `prune()` had **no call sites** (the 30-day retention was never enforced — the write path sweeps
  now); an over-long key was **silently ignored** rather than refused, despite a declared `max`;
  and the engine's key was a **32-bit** hash, which became a lost-write risk the moment a door
  honoured it (128-bit now). Details in `WEAVE.md` §3.4.
  ⚠️ **Why the gap survived is worth more than the fix:** `check:rulings` covered the SENDING half
  against an injected dispatcher and proved the key is derived — never that anything acted on it.
  The new suite writes through the real route into real SQLite and **counts rows**.
- **BeigeBoard's `/api/items` is the one unpaginated dataset in a suite with a pagination ruling.**
  ⚠️ **That absence is currently load-bearing** — it is why `bbDelta`'s merge is safe. Adding a
  limit while keeping `ORDER BY id ASC` advances the cursor past unseen rows on the first
  page-sized delta: silent row loss, the exact failure that module exists to prevent.
  **Page it by the cursor column or not at all.**
- **KourOS's `/api/albums` still pages by `offset`** — a deliberate, bounded exception to ruling 2,
  noted at the call site. ⚠️ **Its un-defer trigger: the moment that catalog gains incremental
  writes** (a user-editable tag, a rating that reorders), it becomes exactly the bug the ruling
  describes.
- ✅ **`check:audit` floor raised from `critical` to `high` — DONE 2026-09-16** (D4). 7 packages
  carried HIGH advisories; 0 do now. ORDECK moved to vite 6; postcss, nanoid, browserslist and
  brace-expansion got range-scoped floors in `pnpm-workspace.yaml`; the last three were reachable
  only through SylibOS, which was removed. ⚠️ **Still open, below the floor:** `qs` (MODERATE — a
  DoS reachable at runtime through Express in every backend). Its fix is a minor past a parent's
  declared range, which D4 did not license; it wants the Express upgrade, not a floor.
- **Two designed seams stay deferred, with their triggers** (`WEAVE.md` §7): **transport 1 → 3**
  (registry-driven CORS) when a peer genuinely cannot be nginx-proxied — every peer is proxied
  today; and **runtime `app_registry` CRUD**, plus a `_cachedAppOrigins` bust and dynamic nginx
  regeneration, when apps must be added without a deploy.

⚠️ **Do not build an "is anything consuming this contract?" probe.** An unconsumed contract is the
correct steady state, and the only way to satisfy such a probe is to invent consumers.

---

## 7 · Stage F — the design factory

**Not started.** ✅ *Decided: the visual language is parked for the duration* — this is a
restructure, not a retune. If a visual change is wanted, it is a separate pass *after* this lands.

**The deliverable is a machine-readable manifest**, the way `discovery.js` emits one for backends:
pure data, requireable with no browser, so the next run's widget factory can enumerate what
primitives exist and what nests in what. Today nothing can — `hub.css` is a 2,700+ line stylesheet
and `check:design` only scrapes top-level class names.

✅ **Step zero — the byte-identity harness. DONE 2026-09-10.** `pnpm check:token-identity`
(`test/token-identity.mjs`) serves `hub.css` to a real headless Chromium and pins what all **152**
`:root` tokens compute to on both faces, in `packages/design/tokens/computed-baseline.json`.
⚠️ **Every other gate in this suite is a text scan and none of them can tell you a colour
changed** — rewrite `--hub-amber` from `#ffb000` to `#ffb100` and the whole repo stays green.
It records the substituted text **and** the used value after `color-mix()` is evaluated, so a mix
percentage cannot move invisibly either. Measured: 142 of the 152 differ between the faces.

**It is built for the edit Stage F actually is.** A rename that PRESERVES the value passes and is
reported as `old → new`; a surviving name whose value moved, an orphaned name, or a genuinely new
token fails and is listed. Accept an intended change with `--update` — the JSON diff is the visual
review this suite has never had. All four paths were proved by planting each one.

**Still open at this level: BeigeBoard is the specification, not the test case** — the factory is
correct iff it can express BB with identical computed values, and anything it cannot express
without a bespoke escape hatch is a **missing primitive**, almost certainly one ORDECK needs too.
That is a second harness (render BB's DOM, dump every element's computed properties) and it is
worth building against the factory rather than before it.

Then, in the order the reasoning gives (`RESET.md` Stage F):

- **Name the tiers and make the prefix carry the tier** — 152 tokens, 62 on both faces, 90
  light-only, 0 dark-only. **Only tier 1 gets a dark block.** Today `--hub-*` spans tiers 1 and 3,
  so "does this token need a dark value?" is answerable only by reading the whole file.
- ✅ **The on-accent colour is DERIVED, not pinned — DONE 2026-09-16** (D10 answered: (3)).
  `--color-accent-contrast` is black or white by the accent's exact WCAG relative luminance,
  computed in CSS (`color(from var(--color-accent) srgb-linear …)` exposes the linear channels;
  the switch sits at Y = 0.17913, where the two contrasts are equal), for both faces, behind an
  `@supports` with a per-face literal fallback. **Measured in Chromium across all four presets
  and six custom accents on both faces (20 cases):** before, every preset FAILED AA on paper
  (3.07–3.77:1) and a dark custom deep blue got black text at 2.03:1; after, every case gets the
  best contrast black-or-white can give, and all 20 pass AA (lowest 5.30:1). The paper face's
  primary buttons now read black on the accent, not white. `check:token-identity` recorded the
  change (`--update`, 4 lines of baseline).
  *Related and already fixed:* the far worse defect in the same chain — a custom-property cycle
  that made the button **invisible** at 1.19:1 — closed 2026-09-10; see §8's closed table.
- **Collapse the four accent schemes** (`--accent-raw`, `--hub-amber`, `--color-accent`, `--accent`)
  and **retire the pigment names** — nothing in the token layer should name a colour it might not be.
- **Reorder by system**, not by the program that added each section: ground → type → colour chain →
  geometry → materials → controls → motion. Delete every archaeological label.
- **Migrate the 26 un-namespaced global classes into `.jk-*`** and delete the duplicates
  (`.glow` and `.jk-glow` both exist).
- **Decide the 2,731-line generated mirror.** [`apps/jkauth/public/jkos-tokens.css`](../apps/jkauth/public/jkos-tokens.css)
  is a full copy because jkAuth is statically served. Gated by `check:tokens`, so it is safe — but
  every structural change is a change to two files. **Keep it as a build artifact, or give jkAuth a
  build step.**
- **Glass — the provenance material.** ✅ *Decided:* **glass is for pixels the suite didn't author;
  paper and press are for pixels it drew.** Delete the ambient decoration in
  [`apps/kouros/src/glass.css`](../apps/kouros/src/glass.css) (275 lines, 27 raw `rgba`/`hsl`
  literals, all chrome), promote the glass tokens into the factory, apply them on the cover
  primitive — PapyrOS's jackets and ORDECK then get it free.
  ✅ **The two named `CoverArt`s — converged 2026-09-16.** The player kit's copy had **no consumers**
  and is deleted; PapyrOS's player bar hand-rolled a third (`CoverThumb`) and now renders
  `<CoverArt variant="thumb">` from `@jkos/ui`. `.pb-cover` moved into `hub.css` as
  `.jk-media-thumb` — **all 627 computed properties identical on both faces**, measured in Chromium
  against the old stylesheet. One real fix rode along: `CoverThumb` never reset its failure flag,
  so a book whose cover 404'd blanked every later book's cover until the bar remounted.
  ⚠️ **Three more cover implementations exist, and glass cannot land on "the cover primitive" until
  they use it:** [`apps/kouros/src/components/Cover.tsx`](../apps/kouros/src/components/Cover.tsx)
  (11 call sites; a wrapper `div.kr-cover` around the `img`, a letter fallback, `eager` and
  `decoding="async"`, and descendant CSS in `views.css` that assumes that DOM), and PapyrOS's
  BookDetail hero (inline, with a cache-busting `?v=`). Converging KourOS's changes its DOM and the
  selectors that style it, so it wants the BeigeBoard-style computed-style harness this section
  already calls for — not a blind swap. That is also where `eager`/`decoding` and a letter
  fallback become props of the one primitive rather than a second component.

---

## 8 · Documentation

- **`DESIGN.md` is stale by 1,167 lines across 13 commits and now says so.** Re-syncing its value
  tables **waits on Stage F by design** — F renames the tiers, collapses the accent schemes and
  retires the pigment names, so refreshing the values first is work done twice and discarded once.
  Its banner points at `hub.css` as authoritative in the meantime.
- ⚠️ **When you close something here, `check:docs` will hold the rest of the documentation to it.**
  It derives the suite list from `test:contracts` rather than trusting a hand-kept list, because
  `TESTING.md` was silently missing eight suites and ~290 assertions.
- ✅ **The hero-shot pack exists** — published at <https://claude.ai/code/artifact/5e53f12f-cf7d-4e22-b066-4087b47a3e80>, with the 2× originals generated
  into `Documentation/Images/` (**gitignored** — they are screenshots of real personal data)
  and the combined handoff artifact linked from it. Every frame is a real signed-in session against
  a real backend, not a mock, so the pack doubles as evidence of what the apps actually render.
  It is what turned up the four defects closed on 2026-09-10 (below).

### ✅ Closed 2026-09-10 — found by shooting the apps rather than reading them

Four defects, all live in shipped code, none of which threw. Recorded here because the *class*
matters more than the four: **every one was invisible to a green gate**, and three were invisible
to the code as well (a CSS cycle, a lying type, a lying comment).

| | Fix | Where the mechanism is written up |
|---|---|---|
| jkAuth's primary buttons invisible at 1.19:1 (custom-property cycle) | `apps/jkauth/public/style.css` — the alias is gone | [DESIGN.md §3](DESIGN.md) · TRAPS.md § CSS |
| PapyrOS printed raw HTML in 16 of 18 book blurbs | `plainDescription()` — strips, never injects | `views/book-detail/format.ts` |
| PapyrOS could never offer Resume (a `ref` arrives as `"13"`, compared `===` to `13`) | `withNumericRefs()` at the api boundary — fixed 4 consumers at once | TRAPS.md § SQLite |
| BeigeBoard's production build was dead while the gate stayed green | `commonjsOptions.include` + **`pnpm check:build`** in the gate | TESTING.md · TRAPS.md § Node |

⚠️ **The last one is the one to remember.** `test:contracts` ran every test, every static check
and the prober, and never ran `build` — so "green" never meant "shippable". It does now.

---

## 9 · Ops and infra

- **Backup alerting — ✅ the local half is DONE 2026-09-10; the HUD half is blocked on a decision.**
  `infra/backup/jkos-backup-alert.sh`, wired as two units: `jkos-backup-alert.service` on the
  backup's `OnFailure=` (a run that FAILED), and `jkos-backup-check.timer` on its own schedule
  (a run that was killed, or **never happened** — no exit code to hook, the symptom is an
  absence). Journal first, desktop notification second, since a `--user` unit at 02:30 has no
  session bus. `install.sh` enables both and prints the verdict.
  ⚠️ **Its first run found there is no backup at all.** The SSH keypair exists and the script ran
  once by hand on 2026-08-26; it refused correctly on the missing GPG key, the timer was never
  installed, and nothing has run since. `jkos-backups/` holds a log and a status file and zero
  archives. **This is §0's "set a passphrase only he should know", still open, now measured.**
  ⚠️ **Not installed by me** — `systemctl --user enable` changes Jag's machine, and enabling a
  watcher over a pipeline that cannot yet succeed only teaches him to ignore it. Run
  `infra/backup/install.sh` after the GPG key exists.
  **The HUD widget stays open, and the obstacle is real:** the backup runs on the WORKSTATION and
  every jkOS service runs on the NAS, so no backend in the suite can see `last-run.txt`.
  ORDECK's `useSystems` already renders an up-but-degraded row from any app's `/health` body, so
  the rendering half is free — what is undecided is **where the status is published** (a service
  client posting a line, a file the edge serves, a LAN-only reader). That is Jag's call.
- ✅ **Every backup unit's `ExecStart` was broken — FIXED 2026-09-16.** Found writing the music
  watcher's unit from them as a template: `ExecStart=/media/jag/The Forge/…` unquoted, so systemd
  split the path at the space and would have tried to execute `/media/jag/The`, on every run of
  all three services — **including `jkos-backup-alert.service`, the unit whose whole job is to say
  a backup failed.** And `%20` in `Documentation=` is a unit specifier. Never observed, because the
  units were never installed. Quoted, `%%`-escaped, and `systemd-analyze --user verify` exits 0.
- **The TWA build**, once the keystore exists (§0): `bubblewrap init` → build + sign → add the
  SHA-256 to `infra/nginx/assetlinks.json` → regenerate nginx → **restart, never reload** (the
  confs are bind-mounts and a reload will not re-read a replaced inode).
  ⚠️ The only signal that matters is **no URL bar**, checked with Wi-Fi off. If it is there, it is
  trap 1, 2, 3 or 4 in that order of likelihood.
- **Production DNS for PapyrOS and KourOS** (§1).

---

## 10 · Standing decisions — recorded so they are not re-proposed

- **No scheduler / no cron in this suite** — a decision, not an omission.
- **History rewriting is refused.** Destructive, coordinates with GitHub, Jag's call.
- **SylibOS is gone — removed from the repo 2026-09-16** (Jag: "It is dead"). Do not resurrect it from
  history as part of any sweep; the leave-alone rule that used to stand here died with it.
- **The ORDECK redesign and its widget factory are the NEXT run's**, not this one's. This run
  hands off complete declarations, a settled binding vocabulary, and a readable factory manifest.
- **No third party touches the backups.** The off-box copy lands on Jag's own workstation, pull-only.
- **Python + numpy in KourOS's image: rejected** (§2, block 4).
- **An "is anything consuming this contract?" probe: do not build it** (§6).

---

*Reasoning lives in: [RESET.md](RESET.md) (the mandate, stage by stage) ·
[BACKLOG.md](BACKLOG.md) (what landed, and the audits that found defects inside finished work) ·
[ALGORITHMS.md](ALGORITHMS.md) (§9 for M5–M7, §5–§8 for the LazurOS ladder) ·
[WEAVE.md](WEAVE.md) (§3.4 and §7 for the owed halves) · [DESIGN.md](DESIGN.md) ·
[LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) · [KOUROS_ANDROID.md](KOUROS_ANDROID.md) ·
[TESTING.md](TESTING.md) · [TRAPS.md](TRAPS.md).*
