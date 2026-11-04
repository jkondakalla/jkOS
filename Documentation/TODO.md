# jkOS — TODO

**The one list of open work.** When something is done, delete it; git is the history. Where this
and the code disagree, the code wins. Re-walked 2026-11-04 as the starting point after `v0.1`,
with open work collected from every session since.

---

## 1 · Yours — only you can do these

In order. Everything above "Deploy staging" must happen before the deploy; everything below it
follows.

- **Finish the off-box backup.** Run the two commands in
  [`infra/backup/README.md`](../infra/backup/README.md): one writes the NAS's `authorized_keys`, the
  other sets the GPG passphrase. Then run `infra/backup/install.sh` to enable the timer and the
  failure alerts. ⚠️ **No backup has ever succeeded.** Do this before deploying anything, because
  `staging` holds migrations for jkAuth, BeigeBoard and KourOS. (The hourly on-box ZFS snapshot of
  `Luna/Backends` does exist, as `pool.snapshottask` id 1.)
- **Give `truenas_admin` docker access, durably.** Run `sudo usermod -aG docker truenas_admin`. The
  Post-Init script (`initshutdownscript` id 1) does the same but doesn't stick after a reboot: it
  races the middleware's `/etc/group` rewrite, so it probably needs to wait for the docker service.
  Until this is done, no agent can reach a container.
- **Generate the service-client secrets.** `JKOS_SERVICE_CLIENTS` and `JKOS_DELEGATION_CLIENTS` in
  [`apps/jkauth/.env.example`](../apps/jkauth/.env.example), and `JKOS_SERVICE_CLIENT_ID`/`_SECRET`
  in LazurOS's. Use `openssl rand -hex 32`, and grant `beigeboard:create`, not `beigeboard:write`.
  ⚠️ An id or secret containing `:` or `,` makes jkAuth refuse to boot, deliberately. LazurOS
  refuses to start in production without them.
- **Rebuild jkos-deploy, prune its old images, and rotate `BREAK_GLASS_TOKEN` if it was ever set.**
  Images built before 2026-09-25 contain the host's `jkos-deploy/.env` in a layer
  (`docker image ls jkos-deploy*`, then remove the old ones). Not an incident: anyone who could
  read an image could already reach the docker socket. If §8's P2–P4 are ready by then, this is
  the same rebuild.
- **Rotate the Qobuz password at Qobuz.** It's still in git history at `e3c829a`. Rotation is the
  only fix; history is never rewritten.
- **Set up music-analysis delivery.** Until you do, staging's KourOS shows "0 tracks analysed". Steps
  1–3 of [`infra/music-analysis/README.md`](../infra/music-analysis/README.md):
  1. Create the `Luna/jkos-analysis` dataset and `setperm` it. It mounts over the empty directory
     Docker made.
  2. Run `install.sh`.
  3. Authorise the key under `rrsync -wo -no-del`.

  The analysis is already finished, in `music/out/`. ⚠️ Then **restart the KourOS container**: the
  running one won't see a dataset mounted over its directory.
- **Deploy staging** ("Sync Staging"), then **restart nginx** (never reload). Staging was last
  deployed 2026-09-25; §3 lists what it will pick up.
  ⚠️ This deploy makes nginx refuse hostnames it doesn't host, so `jaaggruthkondakalla.com` (which
  points here and currently shows KourOS by accident) will show a Cloudflare error until the
  portfolio is hosted elsewhere or that DNS record is removed. `sylibos.jkos.net` is refused too.
- **Retire the folded apps on the NAS** (after the deploy). The audiobook data exists on staging
  only. An agent can do steps 1–4 once docker works; step 5 is yours.
  1. **Snapshot the audiobook DB**, never the live file (its data is still all in the `-wal`):
     `docker exec staging-papyros-app node -e "require('better-sqlite3')('/data/papyros.db').exec(\"VACUUM INTO '/data/papyros.snapshot.db'\")"`.
     Copy `papyros.snapshot.db` and `covers/` from `…/Staging/papyros-data/` into
     `…/Staging/kouros-data/import/`.
  2. **Dry run, read the output, then apply:**
     `docker exec staging-kouros-app node scripts/import-papyros.js --from /data/import/papyros.snapshot.db --covers /data/import/covers`,
     then the same command with `--apply`. It never overwrites newer KourOS progress, and a second
     `--apply` does nothing ([the script's header](../apps/kouros/backend/scripts/import-papyros.js)).
  3. **Check** that a book you were partway through shows *Resume* in KourOS → Books.
  4. **Remove the containers:** `staging-papyros-app`, `sylibos-frontend`/`sylibos-api` and
     `staging-sylibos-*`. The deploy already unroutes them (jkAuth migrations 021/022).
  5. **Yours:** the `papyros.jkos.net` and `sylibos.jkos.net` DNS records, and the data dirs
     (`…/Staging/papyros-data`, `…/{Production,Staging}/sylibos-data`) once you're satisfied.
  6. **Then delete the importer**: `import-papyros.js`, its smoke, the schema fixture, its test-port
     claim and its `package.json` chain entry. Those are the last uses of the old names, apart from
     the SQL in jkAuth migrations 012/021/022, which stays as the record.
- **Try the listening session on real devices** (after the deploy; nothing to configure):
  1. The phone as the output with the screen locked: pause, skip, seek and change volume from the
     desktop.
  2. "Tap play on …": move playback to a device nobody has touched since it loaded. This path has
     never been seen, because headless Chromium autoplays.
  3. Through Cloudflare: confirm the real edge streams `text/event-stream`.
  4. Reload the output tab mid-song: the other devices should keep showing the song and its position.
- **The native apps.** Steps in
  [OPERATIONS.md § Native apps](OPERATIONS.md#native-apps-android--desktop).
  1. **An Android toolchain:** `node native/android/toolchain.mjs install ~/Android/jkos --adb` (no
     sudo; it isn't installed yet), or Docker (§2).
  2. **`pnpm android:signing`** creates the one release key for every jkOS Android app, with a
     password you choose. ⚠️ **Back up `~/.jkos/android-release.keystore` off this machine**: lose
     it and no app can be upgraded in place.
  3. **Asset links to the edge:** `node infra/nginx/gen-nginx-weave.mjs`, commit, deploy, restart
     nginx. Until then the TWAs open under a URL bar.
  4. **Install.** Staging APKs (`pnpm android:build`) work today, with a URL bar. KourOS's release
     app also needs the production DNS record below.
  5. **Desktop:** `sudo apt install ./native/desktop/out/jkos/jkos-jkos_0.1.0_amd64.deb` (and the
     KourOS one) after `pnpm dist` (Node ≥ 22.12, see OPERATIONS). The sudo is for the AppArmor
     profile the `.deb` installs.
  6. **KourOS Alpha** ([OPERATIONS.md § KourOS Alpha](OPERATIONS.md#android-kouros-alpha-the-native-app))
     has **never been built by Gradle or run on a device**. Its sources were only type-checked
     against stand-ins. In order:
     a. Deploy staging jkAuth, which carries native sign-in, `JKOS_NATIVE_ENV=staging` and
        migration 024 (additive), and restart nginx with it.
     b. Regenerate `gradle/verification-metadata.xml` (OPERATIONS has the command) and read the new
        checksums.
     c. Build `pnpm android:build -- :kouros:testDebugUnitTest :kouros:assembleDebug` and
        `:kouros:assembleRelease`. `aapt2 dump badging` should show versionName
        `0.1.0-alpha-staging` and exactly four permissions. If it fails, look at the Media3
        signatures first.
     d. Install `native/android/out/kouros-alpha-0.1.0-staging.apk` and test with an admin account:
        sign-in, screen-off playback, lock-screen covers and controls, headphones out, Start radio,
        sign out (then `/auth/security` shows it revoked), and listens appearing in recently played.
     e. Production stays off (`JKOS_NATIVE_ENV` unset in the prod compose). Turning it on is a
        separate decision.
  7. **Try them on real hardware.** None has run on a phone, a tablet or an installed `.deb`: the
     TWAs' URL bar, KourOS's lock-screen controls through Chrome, jkOS Home as the default home (the
     corner hold, the offline screen, rotation), and the desktop app's media keys.
- **The S21 Ultra hub has no video out.** An agent can't reach the phone until there's a picture:
  USB debugging is off and its storage is locked. Try these in order:
  1. Wake the phone after plugging in.
  2. Force a restart: power and volume down for about 10 seconds.
  3. Connect in this order: power to the hub, then the monitor, then the phone last.
  4. Pick the monitor's input by hand.
  5. Try a plain USB-C-to-HDMI adapter to rule the hub in or out.

  Once there's any picture, turn on Wireless debugging and give an agent the pairing code. From
  there it can pin 16:9 1080p, set the refresh rate (a common cause of mirroring artifacts) and
  install jkOS Home with the controller.
- **Production DNS for KourOS.** It's reachable on staging only (`staging.jkos.net/kouros/`).
- **Re-download two zero-byte FLACs:**
  `Dodheimsgard - Black Medium Current (2023)/08. Abyss Perihelion Transit.flac` and
  `Geese - Getting Killed (2025)/11. Long Island City Here I Come.flac`.
- **LazurOS's two hardware facts:** `TODO_EMILY_MAC` and `TODO_EMILY_IP` in
  [`apps/lazuros/deployment.jag.json`](../apps/lazuros/deployment.jag.json).
- **Local leftovers on Emily, yours to delete** (gitignored, so nothing tracks them):
  - `apps/papyros/.env`: a retired app's env file, so read it for anything you still need first;
  - `music/meshes-2s.db` (396 MB, superseded by `meshes.db`);
  - the stray dev databases `./jkos-auth.db*` and `apps/jkauth/src/jkos-auth.db`;
  - `music/.backfill.pid`;
  - in `/mnt/Luna/Backends/Staging/kouros-data`, the hand-copied `music-index.db` and the old 2 s
    `music-meshes.db`, which nothing reads any more.
- **Promote and tag.** "Deploy to prod" promotes `origin/staging`, and GitHub's default branch is
  `staging`, so `main` is off every path (last merged 2026-07-30). Tag the promoted commit as the
  pre-release. The only tag so far is `v0.1`.

---

## 2 · Decisions you owe

Each one blocks work an agent could otherwise do alone. Answer in place.

- **What is the end-of-2026 pre-release, and what is it called?** ⭐ *Recommended:* "staging,
  hardened and deployed", meaning §1 through "Promote and tag", plus whatever of §8 P1–P4 and §4
  fits. Named as post-release work rather than left half-done: §6 phases 6–11, LazurOS L1–L3, KourOS
  Alpha on a device, and the Node 22 move. Version `v0.2.0-pre`, with release notes an agent drafts
  from §3 once you've picked the scope. (Package versions are a mix of `0.1.0`, `0.5.0` and `1.0.0`;
  the release is the moment to make them one.)
- **The deploy console rebuild (§8) needs four answers:**
  1. **Port the controller to Node?** ⭐ Yes. It would use `@jkos/auth-middleware` directly, retire
     `jkos_auth.py` (a second copy of the admin check that already broke `/deploy` once), and put
     the controller on the gate. The alternative is to keep Python and add a test virtualenv.
  2. **Snapshot the databases before each deploy?** `VACUUM INTO` a dated copy of each app's DB
     before `up -d` runs migrations. Keeping the last N means pruning old copies automatically,
     which deletes data, so N is yours to pick.
  3. **LazurOS in prod:** (a) add it to staging; (b) ⭐ take it out of the prod compose until L1,
     since it has never run live and would make the promote fail; (c) keep it and let the preview warn.
  4. **Should P5 wait for phase 9's server renderer?** ⭐ Yes. The alternative makes the deploy
     console the renderer's first consumer, which pulls phase 9 forward.
- **Where does the backup status get published?** The backup runs on the workstation; no backend
  can see `last-run.txt`.
  - **(a) Nothing further.** The journal and desktop notification are enough. ⭐ *Recommended
    while no backup has ever succeeded.*
  - (b) The script POSTs a status line to a suite endpoint under a service client.
  - (c) The workstation copies `last-run.txt` to a path the edge serves (ungated).
- **BeigeBoard `/api/items`: page it, or record "unpaginated" as a standing decision?** It's the one
  unpaginated dataset, and ⚠️ that's load-bearing: it's why ORDECK's `bbDelta` merge is safe. A limit
  with `ORDER BY id ASC` silently drops rows, so **page it by the cursor column or not at all.**
  Only worth it if the production item count is growing, which you can read and an agent can't.
- **Docker for the Android build, or not?** `jag` isn't in the root-equivalent `docker` group.
  - **(a) The local toolchain** (`toolchain.mjs install ~/Android/jkos`): no sudo, one directory,
    includes `adb`. ⭐ *Recommended.*
  - (b) Add `jag` to `docker`. That path is written but has never run.
- **Scope for the next agent run:** Is LazurOS in scope (L2 is plain code; L1 needs the GPU and a
  live Ollama)? May an agent change machine state (systemd units and the like)? Until you say
  otherwise, agents stop at "here is the installer, run it".

---

## 3 · What's on staging and not deployed

Everything since 2026-07-30, when `main` was last merged. The staging *deploy* last ran 2026-09-25.
- the reset program's stages A–E;
- the security fixes;
- the audiobook fold and the listening session;
- widget phases 1–5;
- KourOS Alpha and jkAuth's native sign-in;
- the 2026-11-02 dependency fixes;
- the 2026-11-04 controls work: CONTROLS.md, the root README, and jkDeploy's `PROD_BRANCH` default.

That includes **migrations across jkAuth (through 024, all additive), BeigeBoard and KourOS
(8–15)**, which is why the backup comes first.

---

## 4 · KourOS

- **M5: walking shuffle.** Pick a start, then repeatedly step to a nearby unplayed track, so the set
  drifts. A temperature parameter trades album coherence for variety. This is the feature the
  vector pipeline exists for. It joins KourOS's `tracks` by absolute path. Then draw its path as a
  ribbon through the vibe space.
- **Check on a real phone:**
  - the rune layer (it has never met a thumb);
  - the 3-D pulsarmap's frame rate and feel;
  - the vaporwave `vapor` detail;
  - the vibe space's scrub frame rate;
  - whether the adaptive render scale settles;
  - how the density worker (1.5 s for 3,000 tracks on the workstation) scales to 47,000 on a phone CPU.
- **The vaporwave pulsarmap, if you want to take it further** (opt-in `detail: "vapor"`, a demo):
  tint the sun and sky from the album cover, or bring the video's on-screen display (PLAY ▶,
  timecode, level meter) into the app with real track info.
- **Listening session, not built yet:**
  - **A headless speaker** (a NAS or Pi running mpv). The protocol already admits one
    (`kind: 'speaker'`, a delegated service token writes as the listener); the daemon doesn't exist.
  - **A silent remote's presence lags.** Only the output heartbeats, so a remote that loses signal
    stays "online" until nginx's `send_timeout` (~1 min). A light ping from every device would fix
    it; not needed yet.
- **Listening session, never driven in a browser:** the Queue view as a remote (reorder and remove
  are built but never clicked), and iOS Safari at all.
- *Known behaviour, not a bug:* a private window is a new device every time. Unseen devices are
  forgotten after 90 days.

---

## 5 · LazurOS — the ladder

Code-complete, **never run live.** [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) is the runbook;
reasoning is in [ALGORITHMS.md §5–§8](agents/ALGORITHMS.md).

- **V: the completion-volume read.** Last measured 2026-08-18: zero completed items in the staging
  DB, so migration 13's trigger is unproven live. One real completion closes it. ⚠️ Copy the `-wal`
  with the `.db` when reading it.
- **L1: minimal bring-up.** Ollama, the State node, and jkAuth enrolment. Whisper, Piper and the
  DDGS sidecar are off the critical path.
  - ⚠️ `ollama ps` must show the GPU, or tier 0 is fake.
  - ⚠️ `prompts.json` placeholders must match the capability's body fields in
    [`apps/lazuros/backend/docs.js`](../apps/lazuros/backend/docs.js) exactly, or the job goes `FAILED`.
- **L2: prompt versioning, an audit schema and an eval harness.** First, not last. Gate: one
  capability has a reproducible score.
- **L3: the variance feature.** Prescribed-versus-performed reconciliation: statistics in SQL, an
  LLM only for the proposal text, thin findings suppressed rather than caveated. Gated on V.

---

## 6 · The widget rescope — every screen is widgets

Widgets become what the whole suite is built from, so any piece of UI can be lifted out and reused.
Phases 1–5 are done: the tokens, the language, the harness and ratchets, and KourOS's Home, Now
Playing and Vibe Map as widget pages.
- **Background:** [the rescope report](https://claude.ai/artifact/GLLHmuTZkCnkLmjNzX37zf).
- **How it works:** [WIDGETS.md](agents/WIDGETS.md). The renderer is `@jkos/widget-render`, drawn
  in a `WidgetHost` each app declares.
- **Review:** every visible change is logged before and after on
  [the Rescope Review](https://claude.ai/artifact/5Ti5JYSCumLMNzhzeBYZaY).

**Decided 2026-09-29. Don't re-propose:**

- **Three layers.**
  - *Engines* (code, no JSX: the player, the listening session, the offline book store, calendar
    drag, the routine engine, the router) publish declared **slices** and **actions**.
  - *Widgets* (JSON files) are every screen.
  - *Primitives* (code, in packages) exist only for elements no composition of existing kinds can
    draw.

  Small one-off CSS may stay in an app's stylesheet; a hand-built component may not.
- **Scope is everything,** including jkAuth's pages and jkDeploy's console. **These two
  server-render:** per request for jkAuth, and at build time into a checked-in file for jkDeploy.
  - Forms keep posting.
  - Login works with JS off.
  - The nonce CSP doesn't loosen.
  - A control that needs script hydrates from a same-origin nonce'd bundle, on that page only.
- **Bindings stay `map`/`fmt`/`eq`/`in`/`not`.** A computed value is a declared field or an engine
  action, never a formula in a file.
- **Screens are repo files.** No runtime screen editing, but the format must admit per-user
  rearranging later (the HUD already does it).
- **A widget published through jkAuth binds only declared server contracts** (datasets and
  capabilities), never engine actions or host slices. Held by the validator and by jkAuth's publish.
- **Visuals may improve while moving.** Each screen lands on staging with before/after shots on the
  review page; the agent keeps going and stops only on what you flag.
- **Phones:** one widget per screen, responsive by container. A screen may declare a mobile-tier
  body where the phone UI genuinely differs.
- **Tokens:**
  - `--hub-*` / `--color-*` / `--jk-*` are tiers 1 / 2 / 3, and only tier 1 has a dark block.
  - Pigment names become role names.
  - jkAuth's token mirror stays a checked-in generated file held by `check:tokens`.
  - **hub.css keeps its order** (2026-09-30): sorting it changes what 175 elements render, because
    the order decides equal-specificity ties (TRAPS.md § CSS).

**Remaining phases, in order.** Each ends in something the gate proves, and a new assertion is shown
failing against the old code before it is trusted.

5. **Owed from the KourOS pilot** (take each up where it fits, at the latest with phase 6):
   - **The now-playing card lost its book shape**, the 2:3 spine and kind pill. The `cover`
     primitive's `book` shape exists; the card needs a `size` on `cover` to use it.
   - **Now Playing's small losses:**
     - the desktop pointer parallax;
     - the "30" on a book's ±30 s glyphs;
     - the count in "Bookmarks · 3";
     - the sleep popover, which is now a row of buttons;
     - the radio glyph on "Start a station" (a glyph button draws its glyph OR its text).
   - **Never driven with real audio, on a device, or as a book.** The book face has only been seen
     in its contact sheet.
   - **The Vibe Map's cloud has never been drawn by the new page.** Headless Chromium has no WebGL2,
     so look at it on a real screen.
   - **The Map's near list** lost its thumbnails, the whole-row highlight and its glass readout
     card, until phase 6's shared `TrackRow`. Its screen-reader line lost the track count.
   - **KourOS's host holds the AI kill switch closed** (`aiEnabled: false`). Read the profile's
     switch when a KourOS screen reaches LazurOS.
6. **KourOS, the rest.**
   - A virtual list first (47,000 tracks).
   - Library, books, book detail, playlists (a `sortable` primitive), queue, search, album and
     artist.
   - The shell: tab bar, beacon, rune layer, device picker, action sheet, mini player.
   - Offline books.
   - **One `cover` primitive, with glass as the material for imported pixels.** Converge
     [`Cover.tsx`](../apps/kouros/src/components/Cover.tsx) (11 call sites) and
     [`BookDetail.tsx`](../apps/kouros/src/views/books/BookDetail.tsx)'s inline hero. Promote the
     glass tokens and delete [`glass.css`](../apps/kouros/src/glass.css)'s ambient decoration
     (275 lines).
   - **KourOS's inputs on `.jk-field`**: six raw `<input>`/`<select>`s and a local `appearance`
     reset. Remove KourOS from `check:fields`'s exemptions in the same commit.
7. **BeigeBoard.**
   - One tree: `MobileApp` goes, and the phone detail sheet gets the desktop panel's parity.
   - 763 inline styles down to zero.
   - A `timegrid` primitive folds the ~150 lines `DayView.tsx` and `WeekView.tsx` share.
   - The Workshop (RoutineForge, cadence) moves onto the form controls.
8. **ORDECK's own chrome.** Tray, settings, login and boot. The HUD grid and the Workshop canvas
   become primitives, and the Workshop's panels become widgets.
9. **jkAuth and jkDeploy, server-rendered.**
   - A prebuilt server renderer in jkAuth's image, and its nine pages as widgets.
   - Login, 2FA and recovery with no client JS, and the CSP unchanged.
   - Every jkAuth security suite green.
   - jkDeploy's console generated and checked in, held by a check. This is §8's P5.
10. **The UI action inventory,** generated from the files: every screen → the capabilities and
    actions it can fire → the scopes those require → the roles that reach them. Gated, so a new
    destructive control shows up in the diff.
11. **Then:**
    - Draw the jkOS mark. `apps/ordeck/public/icon.svg` / `icon-maskable.svg` and their PNGs are a
      placeholder dial, and every shell derives its icon from them.
    - Re-sync [DESIGN.md](agents/DESIGN.md) from §4 onward. It is stale until the rescope settles,
      and says so at its top.

---

## 7 · Smaller open items

- **Node 20 is end-of-life (2026-04-30).** Every app image is `node:20-slim`, as is the dev runtime,
  and every supported Electron needs Node ≥ 22.12 (why `native/desktop` sits outside the workspace).
  Moving to Node 22 or 24 is a deploy-gated change across every backend.
- **Each app's prod and staging compose files are mostly the same file.** KourOS's pair shares 95 of
  ~102 lines. A shared base (`extends:`) would stop a variable landing in one and not the other.
  Prove it by diffing `docker compose config` before and after **under Compose v2.32.3** (what
  jkos-deploy runs), and teach `95-env-conformance` and `check:docker` the base file in the same
  change. Deploy-gated.
- **Three controls held by configuration or habit** (each is a known gap in
  [CONTROLS.md](CONTROLS.md); close it there too):
  - BeigeBoard stores calendar OAuth tokens in plaintext when `CALENDAR_ENC_KEY` is unset. The fix
    is weaveAuth's pattern: refuse to start in production without the key. ⚠️ Check that the key is
    set on the NAS *before* that ships, or BeigeBoard won't boot.
  - jkDeploy's `jkos_auth.py` checks `aud` only when `JKOS_APP_ID` is set, and it isn't. It needs a
    registry row first, or the check refuses every token. §8's Node port would replace this.
  - Nothing runs the gate except the author: no CI, no commit hook. A pre-push hook is the cheap
    half; CI needs Python, Docker and Chromium on the runner.
- **jkAuth has two authorization policies.** `policy.js` holds route actions, while `roleClaims()`
  in `db.js` decides the `aud`/`scope` claims every token carries. Folding it in touches the
  token-minting path. It's pinned as an exact three-comparison exception so it can't grow.
- **From the widget factory:**
  - The AccuWeather key sits in `localStorage` and request URLs (ORDECK has no backend to host a
    `defineConnector`).
  - ORDECK's `BbItem` is hand-typed rather than BeigeBoard's `ITEM_SHAPE`. Phase 8 replaces it.
  - A dataset's prose is `description` in KourOS and LazurOS and `doc` nowhere, because
    `DatasetDef` declares neither.
- **KourOS `/api/albums` still pages by `offset`.** A deliberate exception, safe while the catalog
  changes only on rescan. ⚠️ It becomes a bug the moment the catalog gains incremental writes.
- **jkOS Home, not built yet:** file upload, downloads, keep-screen-on, and a real lock (device-owner
  lock-task mode). The bridge answers only `info`
  ([NATIVE.md § The bridge](agents/NATIVE.md)).
- **`pnpm start` for the desktop app crashes on Emily.** Ubuntu 24.04 blocks the unpackaged binary's
  sandbox, so test through the installed `.deb`. Never `--no-sandbox`.
- **Two deferred Weave seams** ([WEAVE.md §7](agents/WEAVE.md)):
  - registry-driven CORS, for when a peer genuinely can't be nginx-proxied;
  - runtime `app_registry` CRUD, for when apps must be added without a deploy.

---

## 8 · jkDeploy — rebuild the console around what's running

The deploy scripts (`infra/scripts/lib-deploy.sh`) are sound. The controller
([main.py](../jkos-deploy/main.py)) and page (`jkos-deploy/static/index.html`) are from June and
answer the wrong questions. The goal is a page that truthfully answers three audit questions: what's
running where (per service, by commit), what this button will change, and who did what, when.

**Found in the 2026-11-04 review:**
- **Running code:**
  - The Production card shows the checkout's commit, not what's running: a failed build leaves the
    card on the new commit while the old images run.
  - No image records its commit.
  - There's no per-service view, and LazurOS is prod-only, so "promote ships what staging ran" is
    false for it.
- **Audit trail:**
  - Nothing records who deployed.
  - Every deploy truncates `last.log`, and `/var/log/jkos-deploy` isn't a volume.
  - The break-glass audit line is erased by the deploy it authorized: `_start()` clears the buffer.
  - The one-deploy-at-a-time guard is in-process only, so a by-hand `deploy-*.sh` can collide.
- **Page:**
  - Error alerts print `[object Object]`.
  - Nothing previews what a promote ships.
  - Blank `.env` files are only mentioned in the log.
  - It uses inline `onclick` handlers, loads Google Fonts, and has no CSP on `/deploy`.
- **Tests:** none for `main.py`. `selftest.sh` is off-gate, and system Python has no `fastapi`.

⚠️ The entry scripts copy themselves to a temp dir before `git reset`, so **a change to
`lib-deploy.sh` takes effect one deploy after the one that ships it.**

- **P1. Images record their commit** (shell and compose only, no controller rebuild):
  - `lib-deploy` exports `JKOS_REVISION`, and every built service gets the label
    `org.opencontainers.image.revision`. The label uses `:-unknown` for the one transitional
    deploy, then `:?`.
  - A `flock` stops two runners overlapping.
  - `check:docker` fails on any `build:` service without the label.
- **P2. A deploy ledger:**
  - A SQLite DB on a named volume, one row per deploy: environment, actor (`sub`, email,
    break-glass or not), from/to commit, start and finish times, outcome.
  - **Append-only, enforced by triggers:** no UPDATE of a finished row, no DELETE.
  - A log file per run, never truncated. Break-glass grants become ledger rows.
  - `PROD_BRANCH` must be set, with no default. It currently defaults to `STAGING_BRANCH` (2026-11-04).
- **P3. Endpoints that report the truth:**
  - `/info`: per environment, the services from `docker compose config`, each with its state,
    health and running commit. A service whose running commit differs from the checkout is flagged.
  - `/plan?env=prod`:
    - the commits from what prod is running up to `origin/staging`;
    - the apps they touch, and whether they touch a migration ladder;
    - services that exist in prod but never ran on staging;
    - keys in an app's `.env.example` that are missing from its `.env`.
- **P4. Tests on the gate**, using a fake `docker` and `git` on PATH. They assert:
  - the actor is recorded;
  - a break-glass row survives its deploy (shown failing on today's code first);
  - the triggers refuse UPDATE and DELETE;
  - the page shows running ≠ checkout after a failed build;
  - a concurrent run gets 409, and the lock refuses a second runner.
- **P5. The page, built from widgets** (§6 phase 9): generated at build time into a checked-in
  `index.html` plus a same-origin script, with a CSP allowing only same-origin scripts and
  self-hosted fonts. Screens: the per-environment service grid, the promote preview with
  confirmation, the live log and the history.
- **P6. Docs:** rewrite the deploy sections of OPERATIONS and ARCHITECTURE from the code. Update
  [CONTROLS.md](CONTROLS.md) CM-2/CM-3 and its known gaps to match.

Order: P1–P4 before the pre-release promote, so the first big promote has a preview and a ledger,
with a small throwaway change to today's page to show the new data. P5 comes after, with phase 9.
P2–P4 need one controller rebuild by you on the host; P1 ships with a normal staging deploy.

---

## 9 · Standing decisions — don't re-propose these

- **No scheduler, no cron in this suite.** A decision, not an omission.
- **Git history is never rewritten.**
- **No third party touches the backups.** The off-box copy is pulled onto your workstation.
- **Retired apps stay retired.** Don't resurrect one from history.
- **No Python or numpy in KourOS's image.** The analysis stays in `music/`, with one copy of the
  transform.
- **No "is anything consuming this contract?" probe.** An unconsumed contract is the correct steady
  state.
- **KourOS runs as one process** (the session hub is in memory).
- **Session routing works like Spotify Connect.** Anything played from any device plays on the
  current output, and moving it is an explicit pick. Volume and crossfade are per device; queue,
  shuffle and repeat belong to the session. Long-term resume is for audiobooks only.
