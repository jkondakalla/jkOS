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
- **Resume the music backfill** — paused at **35,460 / 47,441**. `backfill.py`, no arguments.
  ⚠️ **Read `RESET.md` §0a before touching `music/`** — four named files silently invalidate
  every vector banked so far, with no error.
- **Two zero-byte FLACs** need re-downloading. Not a code defect.
- **LazurOS's two unresolved hardware facts.** `TODO_EMILY_MAC` and `TODO_EMILY_IP` in
  [`apps/lazuros/deployment.jag.json`](../apps/lazuros/deployment.jag.json). The WoL backend
  rejects the placeholder by design, and there is a test asserting it does.
- **The Android keystore.** `infra/nginx/assetlinks.json` carries `"targets": []` — honest, and
  link verification simply fails until a real SHA-256 fingerprint is added. Needs JDK 17 + the
  Android SDK and a keystore **that must not be lost**. (`KOUROS_ANDROID.md`)
- **Deploy / promote — always a button Jag presses.**

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
frequency band — it makes the canvas append-only); meshes are built **on demand and cached**,
never batched across all 47,441 tracks; and it is a **KourOS view behind a declared read**, not
a shared package.

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
   **What is still open is whether (ii) earns a deployed surface:**
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
   ⚠️ **Not yet seen in a browser.** Typechecked, built, and its geometry rendered from a REAL
   served mesh (180 rows, the `!!!` hostile path, end to end through a booted server) — but no
   headless Chromium exists on this box, so the React/canvas wiring itself is unrun.
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

**What would make this wrong:** a second mel implementation; per-track normalisation at any of
the three points it could enter (builder, quantiser, renderer contrast); a streaming protocol
(the mesh is ~20 KB — fetch it whole, reveal by index).

---

## 3 · Music — the rest of the vector space

- **What the resumed backfill still owes**, in order:
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
- **M6 — library map.** UMAP or PCA to 2D: where a track sits relative to the library, and the
  path the current shuffle is taking through it.

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

- **Capability-declared scopes — the remaining half.** C4 made the grant expressible at a finer
  grain (`<app>:create|update|delete` beside the legacy blanket `write`). What is left is having
  jkAuth derive the *grantable set* from each app's registered capability doc rather than from
  the registry row.
  ⚠️ **A real obstacle, worth knowing before starting:** jkAuth stores `capabilities_path` and
  never fetches it, and its container does not carry the other apps' source — so neither an HTTP
  fetch at boot (peers may be down) nor `require()`ing their `discovery.js` (not in the image)
  works as-is. **Deciding where the doc comes from is the actual design question, and it is
  unanswered.**
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
  ⚠️ **Still open: this covers the COLLECTION doors, not every write.** A hand-rolled POST outside
  `defineCollection` still drops the key. The protection is the field in a capability's declared
  `body`, never the existence of the constant.
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
- **Raise the `check:audit` floor from `critical` to `high`.** 6 packages carry HIGH advisories
  (vite, postcss, nanoid, brace-expansion, react-router, pdfjs-dist), every one reached through a
  build/dev dependency rather than a deployed container. ⚠️ Raising it before they upgrade cleanly
  paints the gate red on day one, **and a red gate nobody can turn green is one people learn to
  skip.** The count prints loudly on every run. **The decision is when, not whether.**
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
  ⚠️ **Two `CoverArt` implementations exist.** The one in
  [`packages/player/src/ui/NowPlaying.tsx`](../packages/player/src/ui/NowPlaying.tsx) is frozen
  under a Wave-15 "zero-behaviour-change" contract that finished long ago, and its own comment says
  it should re-point at the `@jkos/ui` one. **Lift the freeze and converge them.**

---

## 8 · Documentation

- **`DESIGN.md` is stale by 1,167 lines across 13 commits and now says so.** Re-syncing its value
  tables **waits on Stage F by design** — F renames the tiers, collapses the accent schemes and
  retires the pigment names, so refreshing the values first is work done twice and discarded once.
  Its banner points at `hub.css` as authoritative in the meantime.
- ⚠️ **When you close something here, `check:docs` will hold the rest of the documentation to it.**
  It derives the suite list from `test:contracts` rather than trusting a hand-kept list, because
  `TESTING.md` was silently missing eight suites and ~290 assertions.

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
- **`apps/sylibos/` is off-limits**, including in suite-wide sweeps — its own development track.
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
