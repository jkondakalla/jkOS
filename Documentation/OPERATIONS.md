# jkOS — Operations

Build, run, deploy, cold start. Host: TrueNAS SCALE (ZFS pool `Luna`), dev machine Emily.

## Local development

Everything runs from the repo root `/media/jag/The Forge/jkOS` — the path has a space, so quote it.

```bash
pnpm install                        # one workspace install (root)
pnpm dev                            # turbo run dev (all apps)
pnpm build                          # turbo run build
pnpm typecheck                      # cheapest whole-suite signal; run first
pnpm --filter @jkos/<app> build     # one app
pnpm --filter @jkos/<app> dev
```

Frontends read `VITE_JKOS_AUTH_URL` (default `https://auth.jkos.net`; dev proxies to `:3100`).
After editing `packages/*`, run `pnpm install` — pnpm copies workspace packages into consumers,
which keep the stale copy until you do. ORDECK's `vite dev` is broken (a CJS `codes.js` import
chain); check ORDECK with `build` + `preview` instead. After any `hub.css` change, regenerate the
token mirrors: `pnpm sync:tokens` (jkAuth's and jkos-deploy's).

## Contract gate

Before pushing: `pnpm test:contracts` — every backend smoke, the write round-trip, every
`check:*` conformance gate (including a real `vite build` of each SPA) and the suite prober.
Exit 0 = green. A failure means a cross-system contract has drifted: fix the source of truth,
not the test. Every command, gate and suite is catalogued in [agents/TESTING.md](agents/TESTING.md).
Post-deploy, `pnpm prove --live https://staging.jkos.net --token <admin jwt>` smokes the edge.

## Docker build model

Every JS image builds from the **repo root context** so `@jkos/*` is visible. Each
`apps/<svc>/docker-compose.yml` sets `build.context: ../..`. Never revert to a per-app context.

```dockerfile
COPY . .
RUN pnpm install --frozen-lockfile --filter <pkg>...
RUN pnpm --filter <pkg> build          # frontends (Vite)
RUN pnpm --filter <pkg> deploy --prod  # backends → self-contained bundle
```

## Compose / ports

Root `docker-compose.yml` (`include:` each `apps/<svc>/docker-compose.yml`) is prod.
`docker-compose.staging.yml` is staging. nginx is separate and owns both Docker networks.

| Container | Net | Port | Behind |
|-----------|-----|------|--------|
| standalone-nginx | jkos-internal + nginx-staging-proxy | 80/443 | — (edge) |
| ordeck-shell | jkos-internal | 80 | jkos.net |
| jkos-auth | jkos-internal | 3100 | auth.jkos.net |
| bb-app | jkos-internal | 3001 | beigeboard.jkos.net |
| kouros-app | jkos-internal | 3011 | kouros.jkos.net (prod pending DNS); `/kouros/` on staging |
| lazuros | host | 8080 | internal |
| staging-* + jkos-deploy | nginx-staging-proxy | — | staging.jkos.net |

KourOS bind-mounts two libraries read-only and needs `ffmpeg` in its image (the Dockerfile
installs it): the audiobooks at `/mnt/Luna/Luna/Plex/Audiobooks` (override with
`AUDIOBOOKS_PATH`) and the music
at `/mnt/Luna/Luna/Plex/Music` by default (override with `MUSIC_PATH`) — the same nested-`Luna/Luna` trap: the host's
top-level `/mnt/Luna/Plex/Music` is a *different, empty* directory, and Docker auto-creates a
missing bind source rather than failing, so the wrong path mounts cleanly and the scan finds
zero files with no error anywhere. LazurOS runs `network_mode: host` to broadcast
Wake-on-LAN packets; nginx reaches it via `host.docker.internal:8080`.

## Deploy (jkos-deploy)

Controller at `staging.jkos.net/deploy/` (admin-gated). Two actions:

- **Deploy Staging** — syncs the staging checkout from `origin/staging`, rebuilds, verifies.
- **Promote to Production** — runs the same pipeline against the prod checkout (`origin/PROD_BRANCH`,
  default `staging` — ships the exact commit just tested on staging).

Both run through `infra/scripts/lib-deploy.sh`. The shared routine:

1. Copies scripts to a tmp dir and re-execs — so `git reset --hard` can't corrupt the running shell.
2. `git -c 'safe.directory=*' fetch origin && reset --hard origin/<branch>`.
3. `docker compose up --build -d`.
4. `verify_containers` — waits 5s, inspects every container; fails if any is not `running`.
5. nginx step: **staging only** (`MANAGE_NGINX=1`) and only when `infra/nginx` changed —
   validates config in a throwaway container, then `reload_nginx` (see § Nginx config below;
   it recreates the container if a bind-mount is missing, else restarts it).
   **Prod deploy always skips nginx** (`MANAGE_NGINX=0`) — standalone-nginx mounts its config
   from the staging checkout; a prod deploy must not restart it with unvalidated config.

- **Redeploy Portfolio** — runs `jkos-deploy/deploy-portfolio.sh`: clones `main` of
  `github.com/jkondakalla/portsite` to a temp folder (the dataset's ACL mode refuses
  the chmod that git, tar and cp all do, so the script writes with mkdir and cat), copies `site/` into `/webhost/Portfolio/site` (nginx's
  read-only mount, so in place, never a folder swap), then fails unless nginx serves those exact
  pages. On success it records the commit for the console's card. Nothing rebuilds or restarts.
  The script ships in the controller's image, so changing it means rebuilding the controller.

**Branch model:** `staging` is the deployable branch. `PROD_BRANCH=staging` in
`jkos-deploy/docker-compose.yml` means "Promote to Production" ships exactly what staging ran.
Flip to `main` to restore a merge-gated flow. The controller cannot redeploy itself — it runs
as an isolated Compose project; rebuild it manually from the TrueNAS host.
`bash jkos-deploy/scripts/selftest.sh` is a read-only dry run of the recovery path (scripts
parse, compose configs validate, nginx conf loads, break-glass gates hold).

### Break-glass access (staging-jkAuth outage)

The `/deploy` console is admin-gated by **staging** jkAuth (issuer `jkos-auth-staging`, keys from
`staging-jkos-auth`), so if staging jkAuth is down you can't sign in to the one tool that
redeploys it (a bootstrap deadlock). A prod jkAuth outage doesn't affect it. Two escape hatches:

- **Break-glass bearer (ARCH-8).** Set `BREAK_GLASS_TOKEN` in the controller's TrueNAS-side
  env (never the repo — `openssl rand -hex 32`). While jkAuth is *unreachable*, the console
  accepts `Authorization: Bearer <token>` as admin on any gated route; every use logs a
  `[SECURITY] BREAK-GLASS …` line to `/var/log/jkos-deploy/last.log`. It is **inert whenever
  jkAuth answers** (`jkauth_reachable()` re-checks live), so a leaked token can't bypass live
  SSO. Example:
  `curl -X POST -H "Authorization: Bearer $BREAK_GLASS_TOKEN" https://staging.jkos.net/deploy/staging/sync`
  Leave `BREAK_GLASS_TOKEN` unset to disable the fallback entirely.
- **Nginx edge gate.** The `auth_request` block in `standalone.conf` *also* fails closed on a
  jkAuth outage. The break-glass bearer is checked by the controller *behind* that gate, so if
  the edge `auth_request` is what's blocking you, hit the container directly on the TrueNAS host
  (`docker exec` / the mapped container port) rather than through the public edge.

## Nginx config

`standalone.conf` is the only **hand-written** config. Four files are **generated** by
`infra/nginx/gen-nginx-weave.mjs` from `@jkos/suite-manifest` — never hand-edit any of them:

| File | Role |
|------|------|
| `weave-proxy.conf` | Prod same-origin peer-proxy include (`/api/<peer>/*`, `/health/<peer>`), NOT admin-gated — each backend enforces its own JWT. |
| `weave-proxy-staging.conf` | The same peer locations, admin-gated (`auth_request`), pointed at `staging-<container>` upstreams. |
| `apps-generated.conf` | Prod origin server blocks for apps that opt into `edge:'standard'` (the `pnpm new-app` scaffolder sets it). Empty (header only) until the first such app. |
| `apps-generated-staging.conf` | The staging admin-gated `location /<id>/` twin of the above. |

```bash
node infra/nginx/gen-nginx-weave.mjs          # regenerate all four files
node infra/nginx/gen-nginx-weave.mjs --check  # CI: exit 1 if any is out of sync
```

All four are file bind-mounts declared in `infra/nginx/docker-compose.yml` (alongside
`standalone.conf`), so they must be mounted before `standalone.conf` can `include` them.

### Recreate, don't (bare) restart

`standalone.conf` and its four generated includes are all **file bind-mounts**, which pins
an inode at container-create time. That has two consequences:

- `nginx -s reload` re-reads the **stale, pre-`git reset` inode** — it is a no-op after a
  deploy's `git reset --hard` and must never be relied on to pick up new config.
- `docker restart standalone-nginx` DOES re-resolve every already-mounted inode to its
  current on-disk content — but it **cannot add a bind-mount that wasn't in the container's
  create-time spec**. If the freshly-checked-out `standalone.conf` now `include`s a
  generated `.conf` file the *running* container was never started with a mount for, a bare
  restart loads a config referencing a missing file and nginx fails to start with
  `[emerg] open() failed (...)` — taking every prod **and** staging site behind the edge
  down at once.

  The fix is to **recreate**, not restart:

  ```bash
  cd /mnt/Luna/Webhost/jkOS-staging/infra/nginx && docker compose up -d
  ```

  `docker compose up -d` reconciles the container's mounts against the checked-out
  `docker-compose.yml`, adding any new bind-mount, then starts it — the one operation that
  can add a mount `restart` cannot.

- `reload_nginx()` in `infra/scripts/lib-deploy.sh` (the deploy pipeline's nginx step)
  **self-heals exactly this**: it diffs every `include` path `standalone.conf` declares
  against what the live container has mounted, recreates via `docker compose up -d` if
  anything is missing, and only falls back to a plain restart when nothing was. A manual,
  ad-hoc `docker restart standalone-nginx` outside the pipeline still carries the full risk
  above — treat it as unsafe whenever the mounted conf set might have drifted.

## Staging

Path-routed under `staging.jkos.net` on the `nginx-staging-proxy` network. Root (`/`) →
staging ORDECK. Bespoke paths: `/auth/`, `/beigeboard/`, `/deploy/`; the
generated `apps-generated-staging.conf` adds `/kouros/`.

The shell is built with `VITE_JKOS_AUTH_URL=https://staging.jkos.net` (same-origin auth).
Admin gate: every gated location runs `auth_request` → **staging** jkAuth
(`staging-jkos-auth:3100/auth/require-admin`, the `/_auth_admin_check` location in
`standalone.conf`). Staging jkAuth must be healthy before staging's gated routes work; a
production jkAuth outage doesn't affect them.

Because of that gate, an **unauthenticated** `pnpm prove --live https://staging.jkos.net`
reports `drift` on every app's health/capabilities checks (302 → the staging sign-in page) — this is
expected staging behaviour, not a regression. Re-run with `--token <admin jwt>` (or
`PROBE_TOKEN=`) for a clean signal.

---

## Native apps (Android + desktop)

Four Android apps and two Linux desktop apps, all declared in `native/shells.js`. The three web
shells load the live site at its real origin, so their auth needs **zero changes**. **KourOS
Alpha** is a native app: it signs in through jkAuth's native sign-in and calls KourOS's API with
a Bearer token. How they're built and why they're shaped this way is in
[agents/NATIVE.md](agents/NATIVE.md); this is the runbook.

| App | Package | What it's for |
|---|---|---|
| **jkOS** | `net.jkos.app` | The suite on your phone (Android) or desktop (Linux). Long-press the Android icon for KourOS / BeigeBoard shortcuts. |
| **KourOS** | `net.jkos.kouros` | Music and audiobooks as their own app (Plexamp to jkOS's Plex). |
| **jkOS Home** | `net.jkos.home` | ORDECK as the home screen of a dedicated tablet or phone. |
| **jkOS Alpha** | `net.jkos.app.alpha` | The suite as one truly native app (Compose UI, Media3 playback), for testing. Installs beside the TWAs. |

A **staging build** (`pnpm android:build`) is named "… (staging)", opens `staging.jkos.net`,
and installs beside the real app. A **release build** opens production.

### Android: the TWA handshake

jkOS and KourOS are **Trusted Web Activities**: Chrome renders the origin with its URL bar
removed. The bar only disappears if Chrome can verify the app and the origin belong to the same
owner. The app's `asset_statements` claims the origin, and the origin's
`/.well-known/assetlinks.json` names the package and its signing key's SHA-256. If either is
missing or they disagree, the app still works but shows a URL bar forever, with no error
anywhere. **Every TWA problem is this problem.** Until the release key exists,
`infra/nginx/assetlinks.json` carries `"targets": []`.

The four traps:

1. **`.well-known/` can't ship in `public/`.** `express.static` ignores dotfiles and the SPA
   fallback answers `index.html` with a 200, so Android's verifier gets HTML. The file is served
   **at the edge** instead, from `infra/nginx/assetlinks.json`: generated into every generated
   prod block, and synced into the hand-written blocks for `jkos.net`, `beigeboard.jkos.net` and
   `auth.jkos.net`.
2. **Every origin a TWA trusts needs asset links, not just its start origin.** Sign-in is a
   redirect to `auth.jkos.net`, and the jkOS app keeps BeigeBoard and KourOS full-screen too. An
   unverified hop puts a URL bar over that page (over the password screen, for jkAuth).
   `pnpm check:nginx` fails if any origin a TWA trusts (derived from `native/shells.js`) serves
   no asset links.
3. **The DNS record must be orange-cloud (proxied, Full (Strict)).** The origin serves a
   Cloudflare Origin Certificate, which is not publicly trusted. Grey-cloud exposes it and
   Android refuses the TWA outright. Check from off-LAN:
   ```bash
   echo | openssl s_client -connect kouros.jkos.net:443 -servername kouros.jkos.net 2>/dev/null \
     | openssl x509 -noout -issuer     # must be Let's Encrypt, NOT Cloudflare Origin CA
   ```
4. **Keep the keystore.** One key signs all four apps. Lose it and you can never ship an
   upgrade to any of them. Back it up somewhere that isn't this machine; it's deliberately not
   in the repo.

### Android: first release

```bash
# 0. The build toolchain, once. Either give this account Docker, or (no sudo):
node native/android/toolchain.mjs install ~/Android/jkos --adb
eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"

# 1. The release key (asks for a password: yours, recorded in your password manager).
#    Writes every TWA package (net.jkos.app and net.jkos.kouros) with its fingerprint into
#    assetlinks.json. A native app needs no asset links: it has no page to verify.
pnpm android:signing

# 2. Put the asset links on every origin, then deploy staging (it owns the nginx config)
#    and RESTART nginx, never reload (bind-mounted confs).
node infra/nginx/gen-nginx-weave.mjs && pnpm check:nginx

# 3. Build signed release APKs → native/android/out/*-release.apk
export JKOS_ANDROID_KEYSTORE=~/.jkos/android-release.keystore
read -rs JKOS_ANDROID_KEYSTORE_PASSWORD && export JKOS_ANDROID_KEYSTORE_PASSWORD
pnpm android:build -- assembleRelease

# 4. Install (USB debugging on), or copy the APK to the phone.
adb install native/android/out/jkos-0.1.0-release.apk
```

A staging build needs no key: `pnpm android:build`, then
`adb install native/android/out/jkos-0.1.0-staging.apk`. It shows a URL bar (staging serves no
asset links), and that's expected.

### Android: jkOS Alpha (the native app)

One native app for the suite, grown from KourOS Alpha (TODO §10). It is being built phase by
phase; this section is rewritten from the code at phase J, and each phase adds its device
checks to the list at the end.

It needs two things in place before it can sign in. Do them in order:

1. **Staging jkAuth deployed with native sign-in.** `apps/jkauth/docker-compose.staging.yml`
   sets `JKOS_NATIVE_ENV=staging`, and jkAuth's migration 024 (a new `sessions.client_id`
   column and a `native_auth_codes` table, both additive) runs on boot. Without the variable,
   every `/auth/native` route is a 404 and the app's Custom Tab shows `Native sign-in is not
   enabled`. Production leaves it unset, so a **release** build can't sign in until that is
   decided.
2. **nginx: restart it with the deploy.** `standalone.conf`'s gate now forwards `Authorization`
   explicitly. `auth_request` already passes it by default, so nothing breaks before the
   restart, but the file and the running server should agree. The staging gate's acceptance of
   a Bearer user token is staging jkAuth's own code. **Restart, never reload.**

The toolchain is in `~/Android/jkos`, and `gradle/verification-metadata.xml` pins every artifact
the build uses (first built 2026-11-16). Build, test and install the staging alpha (no key
needed: it's debug-signed):

```bash
eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"
pnpm android:build -- :ordeck:testDebugUnitTest :ordeck:assembleDebug
adb install native/android/out/jkos-alpha-0.1.0-staging.apk
```

**After bumping an Android dependency**, regenerate the checksums and **read the diff**: every new
sha256 is something you're trusting.

```bash
cd native/android && ./gradlew --write-verification-metadata sha256 \
  assembleDebug assembleRelease :home:testDebugUnitTest :ordeck:testDebugUnitTest
git diff --stat gradle/verification-metadata.xml
```

On the phone: **Sign in with jkOS** opens a Custom Tab on `staging.jkos.net`. Sign in (an
**admin** account: the staging gate admits nobody else) and press **Allow**, and the app comes
back signed in. "ALPHA · staging · 0.1.0-alpha-staging" is on the Home and Account tabs. Things
to try in the KourOS tab, none of which has been seen on a device yet: playback with the screen off; the lock-screen and
notification controls, with covers; pulling the headphones (it should pause); a call (it should
duck or pause); **Start radio**; sign out, then confirm `/auth/security` on staging shows the
app's session as signed out. Each listen should appear in KourOS's recently played. Their
`auth_events` rows (`native_consent`, `native_code`, `native_token`, `native_revoke`) are the
audit trail.

`aapt2 dump badging` and `apksigner verify --print-certs` on the APK should show package
`net.jkos.app.alpha.staging`, versionName `0.1.0-alpha-staging`, and the permissions
INTERNET, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK and WAKE_LOCK, plus androidx.core's
signature-level `net.jkos.app.alpha.staging.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. A library
that merges in anything else fails the build (`:ordeck:checkDebugPermissions`) before an APK
exists.

**Device checks, by phase.** Run the newest build through all of them.

- **D · the shell.** The bottom bar shows Home, BeigeBoard, KourOS and Account (an admin or a
  user: a tab exists only for an app in the token's `aud`). Each tab keeps its own place: open
  an album in KourOS, switch to Account and back, and the album is still open. Back pops the
  tab's screens, then returns to Home, then leaves the app. Tapping the tab you are on returns
  it to its first screen. With music playing, the mini player sits above the bar on every tab,
  and tapping it opens Now Playing in the KourOS tab. Kill the app and reopen it: the same tabs
  appear at once, before any network call. The consent page names **jkOS Alpha (staging)**, and
  `/auth/security` lists the session as app `net.jkos.app.alpha.staging`.

- **F · Account and devices** (needs jkAuth with phase E deployed). The Account tab shows your
  name, email and role. Change the display name and save: Home's greeting follows, and so does
  the web portal after a reload. Pick Paper, Dark or System: the app changes face at once, the
  status-bar icons stay readable, and the web apps follow after a reload. "Your devices" lists
  this phone as **This device** with no sign-out button, your browser sessions as "A browser",
  and signed-out ones last. Sign a browser out from the phone: that browser is bounced to the
  sign-in page on its next request, and `/auth/security` shows it as `user_revoked`. "Open
  account security" opens jkAuth's page in the browser. Sign out, then confirm the phone's
  entry on `/auth/security` reads "signed out (logout)". Kill and reopen the app: it opens in
  the face you chose, before any network call.

- **G1 · Search, queue and playlists** (needs KourOS with the `ids` filter deployed: it ships
  with D and E). The KourOS header has Search, Playlists and Queue.
  - **Search:** type an artist's name. Artists, Albums and Tracks fill in together, and an
    unknown word says "Nothing matches". Open an album from the results, then go back: what you
    typed is still there. Tapping a track plays the results from that track. Its listen is kept
    with no context, so it isn't added as a place in recently played.
  - **⋮ on any track** (and on an album's header): Play now, **Play next** and **Add to queue**
    are separate rows. Play next goes in right after the current track; Add to queue goes at
    the end; with nothing playing, either one just plays. Start a station plays the track,
    then similar ones. Go to album and Go to artist open them in the KourOS tab.
  - **Queue:** lists what the player holds, with "N up next · time left". Drag a grip to
    reorder; the lock-screen and notification controls follow the new order. × removes a row.
    Tapping a row plays it. Rows already played sit dimmed above the current one. With
    TalkBack on, a grip offers "Move up" and "Move down".
  - **Playlists:** make one with New. Rename and delete it from its ⋮ (delete asks first).
    Add a track from any ⋮ → Add to playlist, and add it again: "Already in". Make a playlist
    straight from the picker. Inside a playlist: Play, tap a row to play from there, drag to
    reorder, × to remove. Reload the web's playlist page: same order. Turn on airplane mode and
    reorder: the row snaps back, with "Couldn't save". A listen played from a playlist shows
    the playlist in the web's recently played.
  - Known limit: a drag doesn't scroll the list, so a row can only be dropped somewhere on the
    screen. To move a row further, drop it at the edge, scroll, and drag it again.

- **G2 · Audiobooks.** KourOS → Books.
  - **Library:** every book, with "Continue listening" first for the ones under way, each with
    its progress. Search by title.
  - **A book:** its details, and a description with no HTML showing. Play. Then Pause, open the
    book on the web: it offers Resume at the same place (within ~5 s). Resume on the phone from
    a place set on the web. A finished book starts over. Tap a chapter: it plays from there.
    Chapter rows fill with what you've heard.
  - **The book player:** ±30 s, previous and next chapter (previous within the first 3 s of a
    chapter goes to the one before), and the scrubber across the whole book. The speed button
    cycles 0.75–2.5×. Play a song: it's at 1×. Go back to the book: your speed is back. Kill
    the app: the speed is kept.
  - **Sleep:** set 15 minutes, lock the phone; it pauses on time. Set "End of chapter": it
    pauses as the chapter ends, before the next one starts.
  - **Bookmarks:** add one (with and without a title); it is listed at its time, and on the
    web. Tap it to jump there. Delete it.
  - **Ledger:** a book's listen appears in the web's recently played as the book, never as a
    track. The lock screen and notification show the book's cover and title.

- **G3 · The listening session, the phone as the output** (the web open on a computer as
  the remote).
  - Open KourOS on the phone: the web's device picker lists it as "<model> (jkOS Alpha)",
    online. Rename it on the web; the name is kept after the app restarts.
  - Play an album on the phone: the web shows it playing on the phone, its scrubber moving.
    From the web: pause, play, seek, next, previous, jump to a queue row, remove a row,
    reorder, play next, add to queue, and play another album. Each lands on the phone, and
    the web shows what the phone did. Set the phone's volume from the web's picker.
  - Play a book on the phone: the web shows the book, at its position in the whole book.
    From the web: ±30 s, next and previous chapter, the rate and the sleep timer all land on
    the phone.
  - Transfer from the web to the browser: the phone pauses, and the browser carries on at
    the same second. Transfer back: the phone takes over there.
  - With the web as the output, press play on the phone: the phone becomes the output and the
    web pauses.
  - Lock the phone for 20 minutes while it plays: the web still shows it playing (the stream
    reopens at token expiry, with `reauth`). Turn airplane mode on: within ~45 s the web
    shows it paused. Turn it off: the phone reconnects.
  - Swipe the app away while paused: the web shows the phone offline.

- **G3 · The phone as a remote** (the web playing on a computer).
  - The mini player reads "On <the computer>" with what it plays. Its play/pause and next
    land on the computer.
  - Now Playing shows "Playing on <the computer>", its scrubber on the computer's clock (it
    moves while the computer plays and stops when it pauses). Seek, previous, next. With a
    book: ±30 s, chapters, the rate, and the sleep timer it reports.
  - Play an album, a playlist, a search result and a book on the phone: each plays on the
    computer. Play next and Add to queue from a ⋮ land in the computer's queue.
  - Devices: lists every device, online first, the output marked. Tap the phone: it takes
    over at the same second and the computer pauses. Tap the computer: back again. Drag the
    computer's volume: it changes there.
  - Queue: lists the computer's queue, "On <the computer>", the current row marked. Tap a
    row: the computer plays it. × removes it there. Drag a row: it moves at once, and the
    computer's queue follows.
  - Close the computer's tab mid-song, then play an album on the phone: it plays on the
    phone (the command is refused, so it plays here).

- **H1 · BeigeBoard: Today.**
  - The tab opens on today: the date, the greeting, a line saying how much is left, and a
    meter of done out of all. Then Next up, Other things, Events (a multi-day event shows on
    each of its days), Running behind (with their dates) and Done. Compare with the web's
    mobile Today: the same tasks, in the same order.
  - Add a task, then an event, then one with a time: each appears where it belongs, and on
    the web after a refresh. Turn on airplane mode and add one: "Couldn't add it", and
    nothing half-added once you're back online.
  - Tick a task: it moves to Done, here and on the web. Untick it.
  - Open a task: Focus puts it on ORDECK's focus card (web, after a reload); Focus again
    clears it. Pin adds it to the pinned card; Pin again removes it. Focus something on the
    web: the phone shows it focused after Refresh.
  - Delete a task (it asks first): it's gone here and on the web. Delete a goal with tasks
    under it: they go too.

- **H2 · BeigeBoard: goals, lists, editing, dependencies, deload.**
  - Goals: the year's meter over every task, then each goal with its progress (leaf tasks
    done; a routine's sessions don't count). Compare with the web's mobile Goals.
  - "+ Goal" adds one (on the web it is a year goal). Open it: add a task to it, "+ Add list"
    adds a list, and each list takes its own tasks. Each shows on the web under the same goal.
  - Edit a task: rename it, add notes, move its date, set and clear a time. Edit an event's
    end time and end date. Each is on the web after a refresh, and nothing else changed.
  - Dependencies: on a task, "+ Waits on…" and pick another: it reads "Blocked" until that
    one is ticked. "Waiting on this" shows on the other one. × removes it. Try to make two
    tasks wait on each other: the second is refused ("Couldn't change that").
  - A routine's session (a task under a routine, today or later): "Take this one easy" on,
    and the web shows it lighter; the sessions after it shift back. Off hands it back. A past
    session refuses it.

- **H3 · BeigeBoard: the calendar.**
  - Week: this week's seven days, Monday first, today marked, each day's tasks and events by
    time. A multi-day event shows on each of its days. ‹ and › move by a week; "This week"
    comes back. Compare a week with the web's.
  - Month: the grid, Monday first, a dot on days with something open. Tap a day: its agenda
    is under the grid. ‹ and › move by a month.
  - Tick a task from either view: it's done on Today and on the web.
  - Calendars: each provider, connected (with its account) or "Connect it from BeigeBoard on
    the web". With one connected: Sync now says how many of its events are on the board,
    and they appear. A calendar that answers empty keeps the events the board had, and says so. Disconnect asks first, then its events leave the board, here and on the web.

### Android: jkOS Home on a panel device

Install `home-*.apk`, press Home, and choose **jkOS Home**, then **Always**. To get out: **hold
the top-left corner for 2 seconds**. That opens the drawer, which lists **Android settings**
and **Choose home app** first. If ORDECK is unreachable, the launcher shows an offline screen
and retries every 30 s; the corner hold still works there. For an always-on panel, turn on
*Developer options → Stay awake* while it's charging.

### Linux desktop

Needs Node ≥ 22.12 for Electron's tooling (the suite itself stays on Node 20):

```bash
cd native/desktop
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm install --ignore-workspace
pnpm dist                                    # → out/jkos/*.deb, out/kouros/*.deb
sudo apt install ./out/jkos/jkos-jkos_0.1.0_amd64.deb
```

The `.deb` installs an AppArmor profile so Chromium's sandbox can run on Ubuntu 24.04+. That's
why there's no AppImage, and why `pnpm start` from the source tree crashes on this machine.
**Never add `--no-sandbox`.** A packaged app opens production. It keeps its own profile under
`~/.config/net.jkos.app/`, with cookies encrypted by the OS keyring.

### Verifying

```bash
# JSON, not HTML, on every origin a TWA trusts
for h in jkos.net auth.jkos.net beigeboard.jkos.net kouros.jkos.net; do
  curl -s -o /dev/null -w "$h %{http_code} %{content_type}\n" https://$h/.well-known/assetlinks.json
done
```

Then on the phone, **with Wi-Fi off**, check that each app:

- opens full-screen with no URL bar, including through the login redirect,
- keeps you signed in across a cold start,
- for KourOS, shows artwork, transport and a moving scrubber on the lock screen,
- collapses Now Playing on Android back,
- still opens its shell in airplane mode.

If the URL bar is there, it's trap 1, 2, 3 or 4, in that order of likelihood;
`adb logcat | grep -i digitalasset` usually names which.

---

## Cold start (from zero)

### Prerequisites

**DNS** — A records pointing to your server's public IP:

| Record |
|--------|
| `jkos.net` (apex) |
| `auth.jkos.net` |
| `beigeboard.jkos.net` |
| `staging.jkos.net` |

Use proxied (orange cloud) with Full (Strict) — the origin's Cloudflare Origin Certificate
isn't publicly trusted, and the Android TWAs refuse a grey-cloud origin (§ Native apps).

**SSL** — Cloudflare origin cert (wildcard `*.jkos.net` + apex):

```bash
mkdir -p /mnt/Luna/Backends/ssl
cp chain.pem /mnt/Luna/Backends/ssl/cert.pem && chmod 644 /mnt/Luna/Backends/ssl/cert.pem
cp key.pem   /mnt/Luna/Backends/ssl/key.pem  && chmod 600 /mnt/Luna/Backends/ssl/key.pem
```

**Data directories:**

```bash
for svc in jkos-auth beigeboard; do
  mkdir -p /mnt/Luna/Backends/{Production,Staging}/$svc-data
done
mkdir -p /mnt/Luna/Backends/Production/nginx-logs
```

The five core services above are the from-zero baseline. **Additional apps** (LazurOS,
KourOS) get their `<id>-data` dir created on first deploy — `lib-deploy.sh` self-heals
a missing per-app data dir and `.env`. KourOS's compose files bind both libraries and set
`MUSIC_DIR`/`AUDIOBOOKS_DIR` by default (see § Compose / ports above for
the nested-`Luna/Luna` trap); LazurOS needs a mounted `deployment.json` before it can serve
(copy `deployment.example.json` or `deployment.jag.json` and point
`LAZUROS_DEPLOYMENT_CONFIG` at it — see [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md)).

**RS256 keypair** — generate once. Private key goes in jkAuth only.

```bash
openssl genrsa -out jkos_private.pem 2048
openssl rsa -in jkos_private.pem -pubout -out jkos_public.pem
# Inline \n for .env single-line format:
PRIVATE_KEY=$(awk 'NF {sub(/\r/,""); printf "%s\\n",$0}' jkos_private.pem)
PUBLIC_KEY=$(awk  'NF {sub(/\r/,""); printf "%s\\n",$0}' jkos_public.pem)
echo "JKOS_AUTH_PRIVATE_KEY=$PRIVATE_KEY"
echo "JKOS_AUTH_PUBLIC_KEY=$PUBLIC_KEY"
```

### Clone

```bash
ssh truenas_admin@192.168.1.108
git clone https://github.com/jkondakalla/jkOS.git /mnt/Luna/Webhost/jkOS
git clone https://github.com/jkondakalla/jkOS.git /mnt/Luna/Webhost/jkOS-staging
cd /mnt/Luna/Webhost/jkOS-staging && git -c core.fileMode=false checkout staging
```

### .env files

Copy `.env.example` → `.env` in each app. Key required vars:

| Service | File | Key vars |
|---------|------|----------|
| jkAuth | `apps/jkauth/.env` | `JKOS_AUTH_PRIVATE_KEY`, `JKOS_AUTH_PUBLIC_KEY`, `COOKIE_DOMAIN`, `AUTH_ORIGIN`, `PORTAL_URL`, `ADMIN_SEED_EMAIL/PASSWORD`, `GUEST_PASSWORD` (now an actually-verified credential), `JKOS_2FA_ENC_KEY` (required before anyone can enrol TOTP) |
| BeigeBoard | `apps/beigeboard/.env` | `JKOS_AUTH_PUBLIC_KEY`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `CALENDAR_ENC_KEY` (no AI keys — BB does not call a model; LazurOS writes INTO it) |
| ORDECK | `apps/ordeck/.env` | build-time `VITE_JKOS_AUTH_URL` (prod default baked in) |
| KourOS | `apps/kouros/.env` | `JKOS_AUTH_PUBLIC_KEY`; compose sets `MUSIC_DIR`/`AUDIOBOOKS_DIR` (`/music`, `/audiobooks` in-container), `VECTOR_DB_PATH`/`MESH_DB_PATH` (the `/analysis` mount), and the `KOUROS_BOOKS_AUTO_ENRICH`/`KOUROS_BOOKS_AUTO_COMPAT` toggles |
| LazurOS | `apps/lazuros/.env` | `JKOS_AUTH_PUBLIC_KEY`, `LAZUROS_INTERNAL_TOKEN`, `LAZUROS_DEPLOYMENT_CONFIG` (the mounted `deployment.json`), `JKOS_SERVICE_CLIENT_ID/SECRET` for delegated write-back. **Not a stack service** — host-network compose project of its own; see [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) |

Staging reads the same `.env` files; staging-specific overrides come from
`docker-compose.staging.yml`. Copy to the staging checkout after filling in prod values:

```bash
for app in jkauth beigeboard ordeck; do
  cp /mnt/Luna/Webhost/jkOS/apps/$app/.env \
     /mnt/Luna/Webhost/jkOS-staging/apps/$app/.env
done
```

`CALENDAR_ENC_KEY`: 64 hex chars → AES-256-GCM for calendar OAuth refresh tokens and
the iCloud app-specific password at rest. Generate: `openssl rand -hex 32`.

Key lifecycle (the encryption is prefix-tagged `enc:v1:`, so reads are dual-mode):
- **Unset:** secrets store as plaintext — safe no-op, unchanged legacy behaviour.
- **Adding a key** to a running instance is safe: existing plaintext rows lack the
  `enc:v1:` tag and read back verbatim; new writes encrypt. No migration needed.
- **Removing or changing the key** after rows were encrypted makes those rows
  **undecryptable** — the next sync throws and fails. Recovery is to reconnect the
  affected calendar (the connect flow re-writes the credential under the current key).
  So treat the key as permanent per instance; to rotate, reconnect calendars after.

### Start order

nginx must start first — it creates both Docker networks.

```bash
# 1. nginx
cd /mnt/Luna/Webhost/jkOS/infra/nginx && docker compose up -d

# 2. Production (first build: 5–15 min on cold ZFS)
cd /mnt/Luna/Webhost/jkOS && docker compose up -d --build

# 3. Staging (gated by its own jkAuth, not prod's)
cd /mnt/Luna/Webhost/jkOS-staging && docker compose -f docker-compose.staging.yml up -d --build
```

Verify:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
curl -sk https://auth.jkos.net/health
curl -sk https://jkos.net/ -o /dev/null -w "%{http_code}\n"
```

---

## TrueNAS paths

| Purpose | Path |
|---------|------|
| Repo (prod) | `/mnt/Luna/Webhost/jkOS/` |
| Repo (staging) | `/mnt/Luna/Webhost/jkOS-staging/` |
| Prod data | `/mnt/Luna/Backends/Production/<svc>-data/` |
| Staging data | `/mnt/Luna/Backends/Staging/<svc>-data/` |
| SSL certs | `/mnt/Luna/Backends/ssl/cert.pem` + `key.pem` |
| nginx logs | `/mnt/Luna/Backends/Production/nginx-logs/` |
| Music analysis (KourOS `/analysis`, both envs, `:ro`) | `/mnt/Luna/jkos-analysis/` — its own dataset, not snapshotted, written only by the rrsync-restricted delivery key. Setup and operation: [infra/music-analysis/README.md](../infra/music-analysis/README.md) |

nginx mounts its config from the **staging checkout**
(`/mnt/Luna/Webhost/jkOS-staging/infra/nginx/standalone.conf`). Edit that copy when
changing proxy config. `weave-proxy.conf`, `weave-proxy-staging.conf`, `apps-generated.conf`
and `apps-generated-staging.conf` are all in the same directory; all four are generated
(§ Nginx config), never hand-edited.

## Secrets

Every service reads from a `.env` file (gitignored). `.env.example` in each app is the
reference.

| Variable | Where | Notes |
|----------|-------|-------|
| `JKOS_AUTH_PRIVATE_KEY` | `apps/jkauth/.env` only | RS256 private key, inline `\n`. Never in any other app. |
| `JKOS_AUTH_PUBLIC_KEY` | every backend + jkauth | Required by `@jkos/auth-middleware`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | beigeboard only | Calendar sync only. jkAuth has no Google surface. |
| `JKOS_2FA_ENC_KEY` | `apps/jkauth/.env` | Envelope key sealing TOTP secrets at rest (AES-256-GCM). Generate: `openssl rand -hex 32`. **Unset → TOTP enrolment is refused** rather than writing a readable secret; existing plaintext secrets still verify and are sealed at the first boot that has the key. Losing it makes every enrolled authenticator invalid — treat it like the signing key. |
| `SESSION_TTL_MS` / `SESSION_ABSOLUTE_TTL_MS` / `SESSION_TOMBSTONE_MS` | `apps/jkauth/.env` | Optional. Idle window for an unremembered login (24 h), the absolute cap no activity extends (90 d), and how long revoked-session evidence is kept (30 d). |
| `LAZUROS_INTERNAL_TOKEN` | lazuros + each compute-node worker | Bearer for the State node's `/internal` worker API (LAN-only, not edge-exposed). **Not** shared with BeigeBoard — BB holds no LazurOS keys. |
| `CALENDAR_ENC_KEY` | `apps/beigeboard/.env` | 64 hex chars → AES-256-GCM encryption of calendar OAuth tokens at rest. Generate: `openssl rand -hex 32`. |
| `JKOS_SERVICE_CLIENTS` | `apps/jkauth/.env` | `"id:secret:scopeA\|scopeB,..."` — enables `POST /auth/token` (client-credentials). Unset → endpoint disabled. |

Gitignored globally: `.env*`, `*.pem`, `*.key`, `*.db`.

---

## Gotchas

### pnpm + Docker + TrueNAS ZFS → `ERR_PNPM_EAGAIN`

`copy_file_range` throws `EAGAIN` under Docker overlay-on-ZFS. Fix already in root `.npmrc`:

```ini
package-import-method=hardlink
```

Keep `UV_USE_IO_URING=0` in Dockerfiles. Do **not** add `child-concurrency=1` — it makes
cold builds ~6× slower without fixing the root issue.

### nginx lazy upstreams (`set $upstream`)

All `proxy_pass` directives use the variable pattern:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
set $upstream http://ordeck-shell:80;
proxy_pass $upstream;
```

A literal `proxy_pass` hostname fails nginx startup if that container is down. Mandatory
for every location block.

### nginx config bind-mount inode pinning

Never `nginx -s reload`; restart only when the mounted conf set is unchanged, otherwise
recreate. Full anatomy: § Nginx config above. Prod deploys skip nginx entirely, so a new
peer is inert in prod until a manual recreate.

### git on TrueNAS — mode-bit / lock failures

POSIX_RESTRICTED ACLs cause mode-bit churn and can lock `git config`. Always use:

```bash
git -c core.fileMode=false reset --hard origin/<branch>
```

Never run `git config core.fileMode false` — it can hang on the lock.

### git on TrueNAS — dubious ownership in bind-mounted checkouts

When git runs inside a container that mounted the repo, the file uid differs from the
process uid and git refuses with "dubious ownership". Use `safe.directory=*`:

```bash
git -c 'safe.directory=*' -C /path/to/repo fetch origin
```

**The single quotes are required in zsh** — without them, `*` glob-expands. `lib-deploy.sh`
uses a quoted array (`GIT=(git -c 'safe.directory=*')`) for the same reason.

### Unlabeled pre-existing networks

If `docker compose up` refuses a network, check `docker network inspect <name>`. If
`Labels` is empty, `docker network rm` it and let compose recreate it.

### Data volume permissions

If a container exits with permission errors on `/data`, ensure the host directory is
owned by the user the container runs as (Node alpine images use uid 1000):

```bash
chown -R 1000:1000 /mnt/Luna/Backends/Production/jkos-auth-data
```

---

## Verification after changes

1. `pnpm test:contracts` green (contracts + nginx check).
2. `pnpm build` (or `--filter @jkos/<app>`) green.
3. Per-app `tsc` green.
4. `docker compose build` from root — the real gate that shared-package resolution works in images.
5. Log in, change theme → confirm mode + accent apply identically in all frontends; reload persists
   (proves `PATCH /auth/profile` round-trip works).

## Post-deploy checklist

1. `pnpm prove --live https://staging.jkos.net --token <admin jwt>` — health, docshape,
   directory, admin gate.
2. `node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>` — the write path
   through the real edge.
3. One-time per instance, not per deploy: `BREAK_GLASS_TOKEN` (§ Break-glass access above) and
   `CALENDAR_ENC_KEY` (§ .env files above) — both already documented there; confirm they're set
   before relying on either.
