# jkOS — TODO

**The one list of open work.** When something is done, delete it — git is the history.
Where this and the code disagree, the code wins. Last re-walked against the source 2026-09-24.

---

## 1 · Yours — only you can do these

Roughly in order: the first one gates every deploy.

- **Finish the off-box backup.** Two commands in [`infra/backup/README.md`](../infra/backup/README.md):
  one writes the NAS's `authorized_keys`, one sets the GPG passphrase only you should know. Then
  run `infra/backup/install.sh` to enable the timer and the failure alerts.
  ⚠️ **There is no backup today.** The script ran once by hand (2026-08-26) and correctly refused
  without the GPG key; nothing has run since. Do this **before deploying anything**: `staging`
  now holds migrations for jkAuth, BeigeBoard and KourOS. (The hourly on-box ZFS snapshot of
  `Luna/Backends` does exist, as `pool.snapshottask` id 1.)
- **Generate the service-client secrets.** `JKOS_SERVICE_CLIENTS` and `JKOS_DELEGATION_CLIENTS`
  in [`apps/jkauth/.env.example`](../apps/jkauth/.env.example); `JKOS_SERVICE_CLIENT_ID`/`_SECRET`
  in LazurOS's. `openssl rand -hex 32`; grant `beigeboard:create`, not `beigeboard:write`.
  ⚠️ An id or secret containing `:` or `,` makes jkAuth refuse to boot, deliberately. LazurOS
  refuses to start in production without them.
- **Rotate the Qobuz password at Qobuz.** It's out of the working tree, but still in git history at
  `e3c829a` in every clone and on the remote. Rotation is the only fix (history rewriting stays refused).
- **Set up music-analysis delivery**, steps 1 and 3 of
  [`infra/music-analysis/README.md`](../infra/music-analysis/README.md): create the
  `Luna/jkos-analysis` dataset (⚠️ **before** the next deploy, or Docker creates it root-owned), then
  authorise the delivery key under `rrsync -wo -no-del`. Step 2 (`install.sh`) starts the watcher.
  Until then the watcher's snapshots stop at `music/out/`.
- **Re-download two zero-byte FLACs:**
  `Dodheimsgard - Black Medium Current (2023)/08. Abyss Perihelion Transit.flac` and
  `Geese - Getting Killed (2025)/11. Long Island City Here I Come.flac`.
- **LazurOS's two hardware facts:** `TODO_EMILY_MAC` and `TODO_EMILY_IP` in
  [`apps/lazuros/deployment.jag.json`](../apps/lazuros/deployment.jag.json).
- **The native apps: the release key, then install.** Everything is built and verified except the
  parts that need you. Steps in [OPERATIONS.md § Native apps](OPERATIONS.md#native-apps-android--desktop).
  1. **An Android toolchain.** `node native/android/toolchain.mjs install ~/Android/jkos --adb` (no
     sudo, one directory), or give `jag` Docker access (§2 has the decision).
  2. **`pnpm android:signing`**: create the one release key for jkOS, KourOS and jkOS Home. You
     choose the password. ⚠️ **Back up `~/.jkos/android-release.keystore` off this machine**: losing
     it means no app can ever be upgraded in place.
  3. **Asset links to the edge**: `node infra/nginx/gen-nginx-weave.mjs`, commit, deploy, restart
     nginx. Until then the TWAs open under a URL bar.
  4. **Install.** Staging APKs (`pnpm android:build`) work today, with a URL bar. KourOS's release app
     also needs the production DNS record below.
  5. **Desktop**: `sudo apt install ./native/desktop/out/jkos/jkos-jkos_0.1.0_amd64.deb` (and the
     KourOS one) after `pnpm dist` (Node ≥ 22.12, see OPERATIONS). The `.deb` installs an AppArmor
     profile; that's the sudo.
  6. **Try them on real hardware**: none has run on a phone, a tablet or an installed `.deb` yet.
     The TWAs' URL bar, KourOS's lock-screen controls through Chrome, jkOS Home as the default home
     (the corner hold, the offline screen with Wi-Fi off, rotation), and the desktop app's KDE
     media keys (Chromium's MPRIS bridge, expected but unseen).
- **Give `truenas_admin` docker back — durably.** The NAS rebooted 2026-09-23 and the Post-Init
  script (`usermod -aG docker truenas_admin`, `initshutdownscript` id 1) runs but does not stick:
  `getent group docker` is empty afterwards, so no agent can reach a container. Run
  `sudo usermod -aG docker truenas_admin` now; for the next boot, the script likely needs to
  wait for the docker service before it runs (it is racing the middleware's `/etc/group` rewrite).
- **Retire the two folded/removed apps on the NAS, after the deploy.** The audiobook data exists
  on staging only (production never had a data dir for it). An agent can do 1–4 once docker
  works; 5 is yours.
  1. **Snapshot the audiobook app's DB**, never the live file (its data is still all in the `-wal`):
     `docker exec staging-papyros-app node -e "require('better-sqlite3')('/data/papyros.db').exec(\"VACUUM INTO '/data/papyros.snapshot.db'\")"`,
     then copy `papyros.snapshot.db` and `covers/` from `…/Staging/papyros-data/` into
     `…/Staging/kouros-data/import/`.
  2. **Dry run, read it, then apply:**
     `docker exec staging-kouros-app node scripts/import-papyros.js --from /data/import/papyros.snapshot.db --covers /data/import/covers`,
     then the same with `--apply`. It matches books by folder path (both apps mount `/audiobooks`
     from the same host path), never overwrites newer KourOS progress, and a second `--apply` is a
     no-op ([the script's header](../apps/kouros/backend/scripts/import-papyros.js)).
  3. **Check** a book you were mid-way through shows *Resume* in KourOS → Books.
  4. **Remove the containers:** `staging-papyros-app`, `sylibos-frontend`/`sylibos-api` and
     `staging-sylibos-*`. The deploy already unroutes them (jkAuth migrations 021/022).
  5. **Yours:** the `papyros.jkos.net` and `sylibos.jkos.net` DNS records, and the data dirs
     (`…/Staging/papyros-data`, `…/{Production,Staging}/sylibos-data`) once you're satisfied.
     Offline downloads made in the old audiobook app stay on its origin; download again in KourOS.
  6. **Then delete the importer** (`import-papyros.js`, its smoke, the schema fixture, its test-port
     claim and its `package.json` chain entry) and this item — the last names left in the repo
     apart from the SQL literals in jkAuth migrations 012/021/022, which stay as the record.
- **Try the listening session on staging, after the deploy.** Nothing to configure (additive
  migrations, no new env, no nginx change). Only a real device can show:
  1. **The phone as the output, screen locked.** Play on the phone (the TWA), lock it, then pause,
     skip, seek and change its volume from the desktop.
  2. **"Tap play on …".** Move playback to a device nobody has touched since it loaded. A browser
     that refuses to autoplay should make the other devices say so (headless Chromium autoplays,
     so this path has never been seen).
  3. **Through Cloudflare.** Confirm the real edge streams `text/event-stream`.
  4. **Reload the output tab mid-song.** The other devices should keep showing the song and its
     second throughout, never a blank "nothing playing" (fixed 2026-09-24, not browser-driven).
- **Production DNS for KourOS.** It's reachable on staging only (`staging.jkos.net/kouros/`).
- **Deploy / promote** is always your button.

---

## 2 · Decisions you owe

Each one blocks work an agent could otherwise do alone. Answer in place.

- **Where does the backup status get published?** The backup runs on the workstation and every
  service runs on the NAS, so no backend can see `last-run.txt`. ORDECK's `useSystems` would render
  it for free once it's reachable.
  - **(a) Nothing further.** The journal + desktop notification are enough. ⭐ *Recommended while
    no backup has ever succeeded.*
  - (b) The script POSTs a status line to a suite endpoint under a service client (needs the
    secrets above; adds a write surface whose only writer is a shell script).
  - (c) The workstation copies `last-run.txt` to a path the edge serves (no credential; an ungated file).
- **BeigeBoard `/api/items`: page it, or record "unpaginated" as a standing decision?** It's the one
  unpaginated dataset in a suite with a pagination ruling, and ⚠️ that absence is load-bearing:
  it's why ORDECK's `bbDelta` merge is safe. Adding a limit while keeping `ORDER BY id ASC` silently
  drops rows. **Page it by the cursor column or not at all.** Worth doing only if the production
  item count is actually growing, which is a read you can do and an agent can't.
- **Docker for the Android build, or not?** `jag` isn't in the `docker` group on Emily, and that group
  is root-equivalent. `native/android/build.mjs` supports both paths with the same pinned toolchain.
  - **(a) The local toolchain** (`toolchain.mjs install ~/Android/jkos`). No sudo, nothing outside
    one directory, and it includes `adb` for installing. ⭐ *Recommended.*
  - (b) Add `jag` to `docker`. The Docker path is written but has **never run** (no access), so its
    first run is its test.
- **Scope for the next agent run:**
  - Is Stage F (§6) its main job?
  - Is LazurOS in scope? L1 needs the workstation GPU and a live Ollama, but L2 is plain code and
    could be built first.
  - May an agent install systemd units / change machine state? The default until you say otherwise
    is to stop at "here is the installer, run it".

---

## 3 · What's on staging and not deployed

**Everything since 2026-08-26.** Stages A–E of the reset program, the security fixes (including
the email-OTP expiry fix), the audiobook fold and the listening session. That includes
**migrations across jkAuth (through 022), BeigeBoard and KourOS (8–15)**, which is why the
backup comes first.

**Music data on staging:** the new `music-index.db` (full library, 2026-09-23) is in
`/mnt/Luna/Backends/Staging/kouros-data`. The new 0.1 s `music-meshes.db` (16 GB) deliberately is
**not**: the old code staging runs would blank the pulsarmap on it. The new meshes go with the
deploy of the new code, which reads `/analysis/…` and so needs the `Luna/jkos-analysis` dataset
(§1). Both snapshots are in `music/out/`.

---

## 4 · KourOS

- **M5: walking shuffle.** Pick a start, then repeatedly step to a nearby unplayed track, so the
  set drifts. A temperature parameter trades album coherence against variety. This is the
  feature that justifies the whole vector pipeline. Joins KourOS's `tracks` by absolute path.
  Then draw its path as a ribbon through the vibe space.
- **Now Playing doesn't fit one screen on any common phone** (390×844 overflows by 165 px,
  375×667 by 318, 412×915 by 91, 360×740 by 246), so the rune gesture layer always stands down on
  a phone. The runes are built and gated but unreachable there.
- **Check on a real phone:** the 3-D pulsarmap's frame rate (~44 × 127 × 2 quads a frame; headless
  swiftshader managed ~12 fps) and its feel under a thumb; the vibe space's scrub frame rate, whether
  the adaptive render scale settles, and how the density worker (1.5 s for 3,000 tracks on the
  workstation) scales to 47,000 on a phone CPU.
- **Listening session, not yet built:**
  - **A headless speaker**, e.g. a NAS or Pi running mpv. The protocol already admits one
    (`kind: 'speaker'`, optional `from`, a delegated service token writes as the listener). The
    daemon itself doesn't exist.
  - **A silent remote's presence lags.** Only the output heartbeats. A remote that loses signal
    stays "online" until nginx's `send_timeout` closes its stream (~1 min). A light ping from every
    device would close this; not needed yet.
- **Listening session, not yet driven in a browser:** the Queue view as a remote (reorder/remove
  are relayed commands, built but never clicked), and iOS Safari at all.
- *Known behaviour, not a bug:* a private window is a new device every time. Unseen devices are
  forgotten after 90 days, and the picker folds all but the four most recent behind "Show N more".

---

## 5 · LazurOS — the ladder

Code-complete, **never run live.** [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) is the runbook.
Reasoning: [ALGORITHMS.md §5–§8](agents/ALGORITHMS.md).

- **V: the completion-volume read.** Last measured 2026-08-18: zero completed items in the
  staging DB, so migration 13's trigger is unproven live. One real completion closes it. ⚠️ Copy
  the `-wal` alongside the `.db` when reading it. Re-read before scheduling L3.
- **L1: minimal bring-up.** Ollama + the State node + jkAuth enrolment. Whisper, Piper and the
  DDGS sidecar are cut from the critical path. ⚠️ `ollama ps` must show the GPU, or tier 0 is fake.
  ⚠️ `prompts.json` placeholders must match the capability's body fields in
  [`apps/lazuros/backend/docs.js`](../apps/lazuros/backend/docs.js) exactly, or the job goes `FAILED`.
- **L2: prompt versioning, an audit schema, and an eval harness.** First, not last. Gate: one
  capability has a reproducible score.
- **L3: the variance feature.** Prescribed-vs-performed reconciliation: statistics in SQL, an LLM
  only for the proposal text, thin findings suppressed rather than caveated. Gated on V.

---

## 6 · Stage F — the design factory

**Not started.** The goal is a **machine-readable manifest** of the design primitives: pure data,
requireable with no browser, the way `discovery.js` is for backends. Today nothing can enumerate
what `hub.css` (2,700+ lines) offers. ⚠️ **The visual language is parked for the duration.** This
is a restructure, not a retune; `pnpm check:token-identity` pins every token's computed value on
both faces, so a rename that preserves values passes and anything else is caught.

Decided (2026-09-16): keep `--hub-*` / `--color-*` / `--jk-*` as tiers 1 / 2 / 3 (raw per-face /
semantic alias / face-invariant geometry), only tier 1 gets a dark block, and pigment names become
role names (`--ink-*`, `--ground-*`, `--accent`). The jkAuth token mirror stays a checked-in
generated file held by `check:tokens`.

- **BeigeBoard is the specification.** The factory is correct iff it can express BeigeBoard with
  identical computed values. Anything that needs an escape hatch is a missing primitive. Build a
  harness that dumps every BB element's computed style, against the factory.
- **Make the prefix carry the tier.** 152 tokens (62 on both faces, 90 light-only). `--hub-*`
  currently spans tiers 1 and 3, so moving its tier-3 tokens is most of the work.
- **Collapse the four accent schemes** (`--accent-raw`, `--hub-amber`, `--color-accent`, `--accent`)
  and retire the pigment names. Blast radius was 927 occurrences across 48 files (2026-09-10; re-measure).
  ⚠️ `music/ridge.py` copies the face values as literals and `apps/kouros/src/components/Pulsarmap.tsx`
  aliases the names, so both move with it.
- **Reorder `hub.css` by system** (ground → type → colour chain → geometry → materials → controls →
  motion) and delete the labels named after old programs ("Full Press", "Wave 24").
- **Move the 26 un-namespaced global classes into `.jk-*`** (`.glow`, `.led`, `.seg`, `.stamp`, …)
  and delete duplicates (`.glow` and `.jk-glow` both exist).
- **Glass is the imported-asset material:** glass for pixels the suite didn't author, paper and press
  for pixels it drew. Delete the ambient decoration in [`apps/kouros/src/glass.css`](../apps/kouros/src/glass.css)
  (275 lines, all chrome), promote the glass tokens into the factory, and apply them on the one
  cover primitive (`CoverArt` in `@jkos/ui` / `.jk-media-cover`). ⚠️ First converge the two covers
  that don't use it: [`apps/kouros/src/components/Cover.tsx`](../apps/kouros/src/components/Cover.tsx)
  (11 call sites, a wrapper div + letter fallback that `views.css` styles by descendant) and the
  inline hero in [`apps/kouros/src/views/books/BookDetail.tsx`](../apps/kouros/src/views/books/BookDetail.tsx).
  That changes DOM, so do it behind the computed-style harness, not as a blind swap.
- **Draw the jkOS mark.** `apps/ordeck/public/icon.svg` / `icon-maskable.svg` (and their PNGs) are a
  placeholder dial. They're what the jkOS and jkOS Home apps and ORDECK's PWA install show, derived at
  build time, so redrawing them re-skins every shell.
- **Then re-sync [DESIGN.md](agents/DESIGN.md).** Its value tables are stale by 1,100+ lines of
  `hub.css`, on purpose: refreshing them before the restructure is work done twice.

---

## 7 · Smaller open items

- **Node 20 is end-of-life (2026-04-30)** and every app image is `node:20-slim`, as is the dev
  runtime. Found building the desktop app: every supported Electron needs Node ≥ 22.12, which is
  why `native/desktop` sits outside the workspace. Moving the suite to Node 22 or 24 LTS is a
  dependency-and-image change across every backend, so it's a deploy-gated job, not a drive-by.
- **jkOS Home, not built yet:** file upload (`<input type=file>` does nothing), downloads,
  keep-screen-on, and a real lock (device-owner lock-task mode). The bridge answers only `info`;
  ORDECK doesn't call it yet. Add messages as a feature needs them ([NATIVE.md § The bridge](agents/NATIVE.md)).
- **`pnpm start` for the desktop app crashes on Emily** (Ubuntu 24.04 blocks the unpackaged
  binary's sandbox). Test through the installed `.deb`, or give `node_modules/electron`'s binary
  an AppArmor profile. Never `--no-sandbox`.

- **jkAuth has two authorization policies.** `policy.js` holds route actions; `roleClaims()` in
  `db.js` decides the `aud`/`scope` claims every token carries. Folding it in touches the
  token-minting path. It's pinned as an exact three-comparison exception so it can't grow.
- **KourOS `/api/albums` still pages by `offset`.** A deliberate exception to the pagination ruling,
  safe while the catalog changes only on rescan. ⚠️ It becomes the bug the moment the catalog gains
  incremental writes (a user-editable tag, a rating that reorders).
- **`qs` carries a MODERATE advisory** (a DoS reachable through Express in every backend), below the
  `check:audit` floor. The fix needs the Express upgrade, not a range floor.
- **Two deferred Weave seams** ([WEAVE.md §7](agents/WEAVE.md)): registry-driven CORS, when a peer
  genuinely can't be nginx-proxied; and runtime `app_registry` CRUD (plus cache bust and dynamic
  nginx), when apps must be added without a deploy.

---

## 8 · Standing decisions — don't re-propose these

- **No scheduler / no cron in this suite.** A decision, not an omission.
- **Git history is never rewritten.** Destructive, and it coordinates with GitHub.
- **No third party touches the backups.** The off-box copy is pulled onto your workstation.
- **Retired apps stay retired.** Don't resurrect one from history.
- **The ORDECK redesign and its widget factory come after Stage F.** Stage F hands them the
  manifest.
- **No Python/numpy in KourOS's image.** The analysis stays in `music/`; one copy of the transform.
- **No "is anything consuming this contract?" probe.** An unconsumed contract is the correct
  steady state. The only way to satisfy such a probe is to invent consumers.
- **KourOS runs as one process** (the session hub is in memory).
- **Session routing works like Spotify Connect.** Anything played from any device plays on the
  current output; moving it is an explicit pick. Volume and crossfade are per device; queue,
  shuffle and repeat belong to the session. Long-term resume is for audiobooks only.
