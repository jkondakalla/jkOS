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
- **Rebuild jkos-deploy, and rotate `BREAK_GLASS_TOKEN` if it was ever set.** Until 2026-09-25
  its image was built with `COPY . .` and no `.dockerignore`, so the host's `jkos-deploy/.env`
  sits in a layer of every image built so far. The next build leaves it out (`check:docker` holds
  that). Old images keep it until pruned: `docker image ls jkos-deploy*`, then remove the old
  ones. Anyone who could read an image could already reach the docker socket, so rotate the token
  and move on; it's not an incident.
- **Rotate the Qobuz password at Qobuz.** It's out of the working tree, but still in git history at
  `e3c829a` in every clone and on the remote. Rotation is the only fix (history rewriting stays refused).
- **Set up music-analysis delivery. Until you do, staging's KourOS reads "0 tracks analysed".**
  The 2026-09-25 staging deploy points KourOS at `/analysis/music-index.db`, and it ran before the
  dataset existed, so Docker made `/mnt/Luna/jkos-analysis` an empty root-owned *plain directory*
  (verified 2026-09-28). The analysis itself is finished and shipped in `music/out/`. Steps 1–3 of
  [`infra/music-analysis/README.md`](../infra/music-analysis/README.md): create the
  `Luna/jkos-analysis` dataset + `setperm` (it mounts over the empty directory), run `install.sh`,
  authorise the key under `rrsync -wo -no-del`. The first cycle delivers the existing snapshots.
  ⚠️ Then **restart the KourOS container**: the running one bind-mounted the plain directory and
  does not see a dataset mounted over it afterwards.
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
  - Is LazurOS in scope? L1 needs the workstation GPU and a live Ollama, but L2 is plain code and
    could be built first.
  - May an agent install systemd units / change machine state? The default until you say otherwise
    is to stop at "here is the installer, run it".

---

## 3 · What's on staging and not deployed

**Everything since 2026-08-26.** Stages A–E of the reset program, the security fixes (including
the email-OTP expiry fix), the audiobook fold and the listening session. That includes
**migrations across jkAuth (through 023), BeigeBoard and KourOS (8–15)**, which is why the
backup comes first.

**Music data on staging:** none that staging reads. Its KourOS now reads `/analysis/…`, which is
empty until delivery is set up (§1). The hand-copied `music-index.db` (2026-09-23) and the old 2 s
`music-meshes.db` in `/mnt/Luna/Backends/Staging/kouros-data` are no longer read; removing them is
yours. Both current snapshots are in `music/out/`.

---

## 4 · KourOS

- **M5: walking shuffle.** Pick a start, then repeatedly step to a nearby unplayed track, so the
  set drifts. A temperature parameter trades album coherence against variety. This is the
  feature that justifies the whole vector pipeline. Joins KourOS's `tracks` by absolute path.
  Then draw its path as a ribbon through the vibe space.
- **Try the runes on a real phone.** Now Playing fits one screen at every common size since
  2026-09-25 (measured headless: 0 px overflow from 375×667 to 1920×1080, music and books), so
  the rune layer is live on a phone for the first time. It has never met a thumb.
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

## 6 · The widget rescope — every screen is widgets (Stage F folded in)

Widgets stop being ORDECK's HUD cards and become what the whole suite is built from, so any
piece of UI can be lifted out and reused. The survey and reasoning:
[the rescope report](https://claude.ai/artifact/GLLHmuTZkCnkLmjNzX37zf). Widget factory v2 is
finished (its visual pass, `e2fe9e5`, approved and on staging 2026-09-29 — its message still
says PROPOSAL; history is not rewritten).

**Decided with you 2026-09-29 — don't re-propose:**

- **Three layers.** *Engines* (code, no JSX: the player, the listening session, the offline
  book store, calendar drag, the routine engine, the router) publish declared **slices** and
  **actions**. *Widgets* (JSON files) are every screen. *Primitives* (code, in packages) exist
  only for novel elements — something no composition of existing kinds can draw. Small one-off
  CSS may stay in an app's stylesheet; a hand-built component may not.
- **Scope is everything:** ORDECK, BeigeBoard, KourOS, the shared kits, jkAuth's pages and
  jkDeploy's console. **jkAuth and jkDeploy server-render:** widgets become HTML per request
  (jkAuth) or at build time into a checked-in generated file (jkDeploy). Forms keep posting,
  login works with JS off, and the nonce CSP does not loosen. A control that needs script
  hydrates from a same-origin nonce'd bundle, on that page only.
- **Bindings stay `map`/`fmt`/`eq`/`in`/`not`.** A computed value is a declared field or an
  engine action, never a formula in a file. This is the line that keeps the JSON from becoming
  a worse programming language.
- **Screens are repo files.** No runtime screen editing in this program, but the format must
  admit per-user rearranging later (the HUD already does it) without a rewrite.
- **A widget published through jkAuth binds only declared server contracts** — datasets and
  capabilities, already scope-checked — never engine actions or host slices. Held by the
  validator and by jkAuth's publish.
- **Visuals may improve while moving** (overrules Stage F's "the visual language is parked").
  Each screen lands on staging with its before/after contact sheets on one running review page;
  the agent keeps going and stops only on what you flag. Nothing reaches production until you
  deploy.
- **Phones:** one widget per screen, responsive by container; a screen may declare a mobile-tier
  body where the phone UI genuinely differs (BeigeBoard's agenda week).
- **Pilot:** KourOS — Home, then Now Playing, then the Vibe Map.
- **Stage F's token decisions stand** (2026-09-16): `--hub-*` / `--color-*` / `--jk-*` are
  tiers 1 / 2 / 3 (raw per-face / semantic alias / face-invariant geometry), only tier 1 has a
  dark block, pigment names become role names (`--ink-*`, `--ground-*`, `--accent`), and the
  jkAuth token mirror stays a checked-in generated file held by `check:tokens`.

**The phases, in order.** Each ends in something the gate proves; a new assertion is shown
failing against the old code before it is trusted.

**The renderer is `@jkos/widget-render`**, and an app draws a widget in a `WidgetHost` it
declares (its slices, its host kinds — WIDGETS.md). Every visible change the rescope makes is
logged, before and after, on [the Rescope Review](https://claude.ai/artifact/5Ti5JYSCumLMNzhzeBYZaY).

**hub.css keeps its order** (2026-09-30, overruling Stage F's reorder-by-system): measured, a
sorted file changes what 175 elements render, because the order decides equal-specificity
ties (TRAPS.md § CSS). The component classes get grouped when they move into their primitives.

3. **The language.** Widget inputs + `use`; per-instance `state` + `set`; `on:` events → a
   capability, an engine action, `set` or `go`; host actions declared and typed per app;
   routes (a path → a page widget, a `route` slice, `go`); source `debounce`; `sizing` optional
   (HUD placement only); mobile-tier bodies; portability derived from what a widget binds (like
   `ai`); the published-contract limit above. Each: manifest, a second-tier check, package
   tests, `pnpm widget vocab`, WIDGETS.md.
4. **The harness and the ratchets.** Contact sheets per route (screen × tier × state × face,
   fixtures for slices as well as datasets), the running review page, and two gate ratchets
   pinned at today's counts that only go down: JSX in `apps/*/src` outside the entry, router
   and providers; inline `style={{…}}` (1,119 — 763 in BeigeBoard) down to `vars()` only.
5. **KourOS pilot.** Home (patterns, pages, `use`, routes) → Now Playing (the player engine's
   slices and actions, transport, a `scrubber` primitive) → Vibe Map (a `vibespace` primitive
   with its GL code, density worker and no-WebGL list; local pin/energy state; the debounced
   near list).
6. **KourOS, the rest.** A virtual list first (47,000 tracks). Library, books, book detail,
   playlists (a `sortable` primitive), queue, search, album, artist; the shell (tab bar,
   beacon, rune layer, device picker, action sheet, mini player); offline books. Stage F lands
   here too:
   - **One `cover` primitive, glass as the imported-asset material** (glass for pixels the
     suite didn't author, paper and press for pixels it drew). Converge the two covers that
     skip `CoverArt` — [`Cover.tsx`](../apps/kouros/src/components/Cover.tsx) (11 call sites)
     and [`BookDetail.tsx`](../apps/kouros/src/views/books/BookDetail.tsx)'s inline hero —
     promote the glass tokens, and delete the ambient decoration in
     [`glass.css`](../apps/kouros/src/glass.css) (275 lines, all chrome).
   - **KourOS's inputs on `.jk-field`** — six raw `<input>`/`<select>`s and a local
     `appearance` reset in `views.css`. `check:fields` names KourOS as its one exemption; remove
     it from that list in the same commit.
7. **BeigeBoard.** One tree: `MobileApp` goes, and the phone detail sheet (title, breadcrumbs
   and Delete, nothing else) reaches the desktop panel's parity for free. 763 inline styles to
   zero. A `timegrid` primitive folds the ~150 identical lines `DayView.tsx` and `WeekView.tsx`
   share in `@jkos/cards`. The Workshop (RoutineForge, cadence) on the form controls.
8. **ORDECK's own chrome.** Tray, settings, login, boot; the HUD grid and the Workshop canvas
   become primitives, the Workshop's panels widgets.
9. **jkAuth and jkDeploy, server-rendered.** A prebuilt server renderer in jkAuth's image; its
   nine pages as widgets; login, 2FA and recovery with no client JS; the CSP unchanged; every
   jkAuth security suite green. jkDeploy's console generated and checked in, held by a check.
10. **The UI action inventory.** Generated from the files: every screen → every capability and
    action it can fire → the scopes those require → the roles that reach them. Gated, so a new
    destructive control shows up in the diff.
11. **Then:** draw the jkOS mark (`apps/ordeck/public/icon.svg` / `icon-maskable.svg` and their
    PNGs are a placeholder dial that every shell derives its icon from), and re-sync
    [DESIGN.md](agents/DESIGN.md), stale on purpose until the restructure is done.

---

## 7 · Smaller open items

- **Node 20 is end-of-life (2026-04-30)** and every app image is `node:20-slim`, as is the dev
  runtime. Found building the desktop app: every supported Electron needs Node ≥ 22.12, which is
  why `native/desktop` sits outside the workspace. Moving the suite to Node 22 or 24 LTS is a
  dependency-and-image change across every backend, so it's a deploy-gated job, not a drive-by.
- **Each app's prod and staging compose files are mostly the same file.** KourOS's pair
  shares 95 of ~102 lines; the others 9–25. A shared base (`extends:`) would stop a variable
  landing in one and not the other, but it changes the deploy path. Prove it by diffing
  `docker compose config` before and after **under Compose v2.32.3** (what jkos-deploy runs, not
  Emily's v5), and teach `95-env-conformance`'s compose list and `check:docker` the base file in
  the same change. Deploy-gated, like the Node move.
- **jkOS Home, not built yet:** file upload (`<input type=file>` does nothing), downloads,
  keep-screen-on, and a real lock (device-owner lock-task mode). The bridge answers only `info`;
  ORDECK doesn't call it yet. Add messages as a feature needs them ([NATIVE.md § The bridge](agents/NATIVE.md)).
- **`pnpm start` for the desktop app crashes on Emily** (Ubuntu 24.04 blocks the unpackaged
  binary's sandbox). Test through the installed `.deb`, or give `node_modules/electron`'s binary
  an AppArmor profile. Never `--no-sandbox`.

- **Found building the widget factory:** the AccuWeather key sits in `localStorage` and request URLs
  (ORDECK has no backend to host a `defineConnector`); ORDECK's `BbItem` is hand-typed rather
  than BeigeBoard's `ITEM_SHAPE`; `doc`/`description` and `scope`/`scopes` are spelled both ways
  across apps (the prober misses LazurOS's scopes).
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
- **No Python/numpy in KourOS's image.** The analysis stays in `music/`; one copy of the transform.
- **No "is anything consuming this contract?" probe.** An unconsumed contract is the correct
  steady state. The only way to satisfy such a probe is to invent consumers.
- **KourOS runs as one process** (the session hub is in memory).
- **Session routing works like Spotify Connect.** Anything played from any device plays on the
  current output; moving it is an explicit pick. Volume and crossfade are per device; queue,
  shuffle and repeat belong to the session. Long-term resume is for audiobooks only.
