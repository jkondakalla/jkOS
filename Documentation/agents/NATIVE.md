# jkOS — Native shells (Android + Linux desktop)

Installable apps that show the suite. They come in two kinds:

- **Web shells** load the live site at its real origin. None bundles a copy of a frontend, so
  auth, the `.jkos.net` session cookie and the CORS-free peer proxy work unchanged. A bundled
  app would run at a local origin (`capacitor://localhost`, `file://`) where none of them do,
  which is why Capacitor was rejected for KourOS.
- **Native apps** (`android: 'native'`) have no page at all. Their UI is Kotlin and Compose,
  they call their start app's API directly, and they sign in through jkAuth's **native sign-in**
  (PKCE in a Custom Tab), holding a Bearer token rather than a cookie. KourOS Alpha is the
  first (§ [5](#5--kouros-alpha--the-native-app)).

For the operator's runbook (build, sign, install, verify), see
[OPERATIONS.md § Native apps](../OPERATIONS.md#native-apps-android--desktop).

| Shell | Package | Platforms | Kind | Opens on | Keeps inside itself |
|---|---|---|---|---|---|
| **jkOS** | `net.jkos.app` | Android, Linux | TWA / Electron | ORDECK | every suite app with its own origin |
| **KourOS** | `net.jkos.kouros` | Android, Linux | TWA / Electron | KourOS | KourOS + jkAuth |
| **jkOS Home** | `net.jkos.home` | Android | home-screen launcher | ORDECK | every suite app with its own origin |
| **KourOS Alpha** | `net.jkos.kouros.alpha` | Android | native (Compose + Media3) | KourOS | its API + jkAuth, by Bearer token |

KourOS is part of jkOS **and** its own app (Plex and Plexamp): its own icon, its own entry in
recents, and `kouros.jkos.net` links open in it. jkOS Home is ORDECK as a home panel on a
dedicated tablet or phone, as a kiosk (see [below](#jkos-home--the-launcher)).

A **debug build is a staging build**: package `<id>.staging`, name "… (staging)", pointed at
`staging.jkos.net`. It installs beside the release app, never over it.

---

## 1 · Layout

```
native/
├── shells.js              THE list of shells — one row each. Everything below derives from it.
├── gen-native.mjs         projects shells.js into the generated files (--check in the gate)
├── origin-cases.json      the navigation rule, as test vectors both implementations pass
├── android/               one Gradle project (AGP 9.4, Gradle 9.8, JDK 21, SDK 36)
│   ├── toolchain.json     the pinned JDK + command-line tools + SDK levels (sha256)
│   ├── toolchain.mjs      installs exactly that, into Docker or a local dir
│   ├── build.mjs          `pnpm android:build` — Docker or local SDK, same caches + debug key
│   ├── signing.mjs        `pnpm android:signing` — the release key → assetlinks.json
│   ├── Dockerfile         the build image: node:20-slim by digest + toolchain.mjs
│   ├── shells.json        GENERATED — flavors, package ids, icons, version
│   ├── gradle/verification-metadata.xml   sha256 of every Maven artifact
│   ├── twa/               :twa — one flavor per TWA shell; no app code
│   │   └── src/<shell><Debug|Release>/res/   GENERATED per variant
│   ├── home/              :home — the launcher (Kotlin)
│   │   └── src/<debug|release>/res/          GENERATED per build type
│   └── kouros/            :kouros — KourOS Alpha, a native app (Kotlin + Compose + Media3)
│       └── src/<debug|release>/res/          GENERATED: api_base, auth_origin, client_id, redirect_uri
├── play-context-cases.json  what a listen's `context` must be, as vectors the app and the server pass
└── desktop/               Electron — OUTSIDE the pnpm workspace (own lockfile)
    ├── src/policy.js      every security decision, pure (the gate requires it)
    ├── src/main.js        applies policy.js; nothing else
    ├── src/shells.json    GENERATED
    └── scripts/dist.mjs   `pnpm dist` → out/<shell>/*.deb
```

## 2 · What derives from what

Nothing about a shell is typed twice. `shells.js` declares only what is a real decision: id,
name, package, which app it opens on, what it reaches, and its Android kind. From that:

- **Origins** come from `@jkos/suite-manifest`. `reach: 'suite'` means every app with its own
  production origin (so not LazurOS, which has none, and not jkDeploy, which lives under the
  staging origin). jkAuth is always added, because sign-in is a full-page redirect to it.
  Adding an app to the suite reaches those shells with no edit in `native/`.
- **The icon and bar colour** come from the start app's **web manifest**
  (`apps/<start>/public/manifest.webmanifest`): its 512 px PNGs by purpose, and `theme_color`.
  The Android build copies the maskable PNG in at build time (`ShellIcon` in
  `native/android/build.gradle.kts`). Nothing is redrawn and nothing is committed twice.
- **Staging URLs** are `staging.jkos.net` + `/` for ORDECK or `/<id>/` for any other app.
  `check:native` holds each one to a real `location` in the staging server block.
- **The asset links** (what Chrome checks before hiding the URL bar) come from `signing.mjs`.
  It writes every TWA package with the one release fingerprint into `infra/nginx/assetlinks.json`,
  and `gen-nginx-weave.mjs --check` fails if any origin a TWA trusts doesn't serve them.
- **SDK levels** (`compileSdk`, build-tools) come from `toolchain.json`, which both the installer
  and Gradle read. **The version** (`VERSION` in `shells.js`) sets Android's `versionName` and
  `versionCode` (`1.2.3` → `10203`), and the desktop `package.json` must equal it.

- **A native app's identity** comes from `nativeConfig()`: its package is its jkAuth client id,
  and `<package>:/oauth2redirect` its redirect URI. `gen-native.mjs` writes the same pair into
  the app's `shell.xml` *and* into `apps/jkauth/src/native-clients.json`, the list jkAuth
  honours, so the APK and the server can't disagree about where a code may be sent. A native
  app's Gradle module is named after its start app (`:kouros`), and `settings.gradle.kts`
  includes every one listed in `shells.json`.

The generated files are **checked in**, not built inside Gradle: an origin list is a grant, and a
grant should be reviewable in a diff in the exact form the APK will carry it. So is a redirect
URI.

## 3 · The trust model

**The origin list is the trust boundary.** Each shell keeps a navigation inside itself only if
it lands on one of its origins. What happens to anything else depends on the shell:

| | Off-list navigation | Page gets | Native code beside the page |
|---|---|---|---|
| TWA (jkOS, KourOS) | Chrome shows its URL bar / opens it in the browser | nothing Chrome doesn't give any site | none |
| Desktop (Electron) | handed to the system browser (`https:`/`http:`/`mailto:` only; never `file:` or a custom scheme) | no Node, no preload, one permission (`clipboard-sanitized-write`) | the main process, which decides by `policy.js` |
| jkOS Home | **refused**: a kiosk doesn't give a guest the browser | the `jkosShell` bridge on the start origin only | the launcher |
| KourOS Alpha | there are no navigations: no WebView, no page | nothing | the whole app; its trust list is `api_base` (the only host that gets its token) and `auth_origin` |

**One navigation rule, two implementations.** The rule is https only, no userinfo, the default
port only, and the origin exactly equal to a listed origin, with no prefix, suffix or pattern
match. It lives in `native/origin-cases.json` as 25 test vectors. `OriginPolicy.kt` (Android,
JVM unit test) and `policy.js` (desktop, `check:native`) must both return the declared answer
for every case. They can't share code (Kotlin vs JS), so they share a declared behaviour.

**Least privilege, as shipped:**

- **The TWAs** declare no permissions and no code. Merged in from the libraries: a `<queries>`
  entry to find a browser (from androidbrowserhelper), plus androidx's standard non-exported
  startup provider and a profile-installer receiver gated by the system-only `DUMP` permission.
- **jkOS Home** asks for `INTERNET` only. `<queries>` is exactly MAIN/LAUNCHER, never
  `QUERY_ALL_PACKAGES`. The network security config allows https and system CAs only, and the
  drawer activity isn't exported.
- **Both Android apps** set `allowBackup="false"` *and* data-extraction rules that exclude the
  data root from cloud backup **and** device transfer. `allowBackup` alone doesn't stop Android
  12+'s device-to-device copy, and the WebView's cookie jar holds a live session.
- **The desktop app** flips Electron fuses in the binary itself: no run-as-Node, no
  `NODE_OPTIONS`/`--inspect`, only its own integrity-checked asar, and cookies encrypted at rest
  with the OS keyring. It also keeps a separate profile per shell × environment.

### The bridge (jkOS Home only)

On the start origin (ORDECK) only, in the main frame only, the page gets `window.jkosShell`.
It's injected by `WebViewCompat.addWebMessageListener`, **never** `addJavascriptInterface`:
that one is injected into every frame of every origin the WebView ever shows and can't tell
them apart. `check:native` fails on any `addJavascriptInterface`.

| Message (page → shell) | Reply |
|---|---|
| `{"type":"info"}` | `{"type":"info","shell":"home","package":"net.jkos.home","version":"0.1.0"}` |
| anything else | `{"type":"error","error":"unknown message type"}` |

```js
if (window.jkosShell) {                      // absent everywhere except jkOS Home
  jkosShell.onmessage = (e) => console.log(JSON.parse(e.data))
  jkosShell.postMessage(JSON.stringify({ type: 'info' }))
}
```

That's the whole surface today. To add a message, add a row here and a `when` branch in
`Bridge.kt`, and keep each reply a declared shape. An app on a WebView too old for
origin-scoped listeners gets no bridge at all (the page still works).

## 4 · jkOS Home — the launcher

- **It never strands the device.** An unreachable portal (NAS rebooting, Wi-Fi down, a 5xx at
  the edge) shows a native offline screen that retries every 30 s. A renderer crash rebuilds
  the activity. Home, while the portal is down, retries at once.
- **The hidden drawer:** hold one finger still in the **top-left corner (48 dp) for 2 s**. It
  lists **Android settings** and **Choose home app** first (the way out in every state), then
  every app with a launcher icon. The gesture watches touches without consuming them, so the
  page underneath gets every event until it fires. It keeps guests out, not someone who knows
  it's there. For a real lock, use device-owner lock-task mode, which needs a factory reset
  and isn't built.
- Back walks the page's history and stops: a home screen has nothing behind it.
- **Not built yet:** file upload (`<input type=file>` does nothing), downloads, keep-screen-on
  (use Android's "Stay awake while charging" for now), and lock-screen media controls. A
  WebView doesn't forward Media Session the way Chrome does, so for music on a phone, use the
  KourOS app.

## 5 · KourOS Alpha — the native app

KourOS as a real Android app: Compose UI, Media3 playback, no WebView, no bundled frontend.
Package `net.jkos.kouros.alpha` (a debug build is `….staging`, against `staging.jkos.net`), so
it installs beside the KourOS TWA. Its versionName carries the channel: `0.1.0-alpha` (release),
`0.1.0-alpha-staging` (debug). That string is on screen as "ALPHA · staging · …".

### Sign-in: jkAuth's native sign-in

OAuth 2.0 for native apps (RFC 8252), authorization code + PKCE (RFC 7636):

1. The app makes a PKCE pair and a `state`, **seals them to disk first**, then opens
   `${auth_origin}/auth/native/authorize?…&code_challenge=…&code_challenge_method=S256&state=…`
   in a **Custom Tab**: the system browser's engine, with its cookies. The password is typed into
   jkAuth's own page, never into the app.
2. jkAuth signs the person in if needed (its normal login and 2FA), then shows a consent page
   naming the app and the account. **Allow** → `302 <applicationId>:/oauth2redirect?code&state`.
3. `RedirectActivity` (the only filter: VIEW/BROWSABLE on scheme `${applicationId}`) hands the
   URI to `Auth`, which requires the exact registered redirect path, a `state` equal to the
   pending attempt's (and no older than 15 min), and then spends the attempt.
4. `POST /auth/native/token` (`authorization_code` + the verifier) → an access token (the
   suite's ordinary user JWT, `azp: kouros`) and a refresh token.

Android ignores a filter's `path` when it names no `host`, so the filter is the scheme alone and
the path is checked in code. Any app could fire the redirect intent, which is why `state` and
PKCE exist: an injected code fails the state check, and an intercepted one has no verifier.

### The session is transport-bound

A native session is a jkAuth `sessions` row like a browser's (same 30-day idle window, same
absolute cap, same rotation and reuse detection), with one more column: **`client_id`**.
NULL means a cookie session and the app's client id means a native one, and each path accepts
only its own kind. A native refresh token presented as the `jkos_refresh` cookie is a
non-session (`/auth/refresh` 401s and the gate's cookie fallback ignores it). A browser's
refresh cookie at `/auth/native/token` is `invalid_grant`. A trigger (migration 024) makes the
column immutable, and the devices list at `/auth/security` names the app. Codes are 256 bits,
stored as sha256, live 60 s, single-use (another trigger), and are bound to client, redirect
and challenge. A code presented twice burns the session its first redemption minted.

In the app:

- **The refresh token** lives only in `no_backup/session.bin`: AES-256-GCM under an Android
  Keystore key, written atomically. The **access token** lives in memory and renews 60 s
  before it expires.
- **Refreshes are serialised** (one `Mutex`). jkAuth rotates refresh tokens, and a phone has no
  shared cookie jar, so two concurrent refreshes would spend one token twice and the second
  use, seconds later, is theft to the server. A new refresh token is written to disk *before*
  the new access token is used. `invalid_grant` = signed out. A `409 REFRESH_RACE` should be
  impossible with the lock and is reported, not retried.
- **Sign out** calls `POST /auth/native/revoke` (the whole family) and deletes both files.
- **The Bearer header** goes only to URLs under `api_base` (`Api.authorized`), from the API
  client and from the player's data source, and from nowhere else.
- **Redirects are not followed.** Behind the staging edge gate an unauthenticated API call is
  answered with a **302 to the sign-in page**, not a 401. Followed, it becomes a 200 of HTML.
  A 3xx is treated as a 401: renew once, retry once.
- **The staging gate** (`/_auth_admin_check` → `/auth/require-admin`) accepts the app's Bearer
  token. nginx's `auth_request` forwards the request's `Authorization` header by default. Only
  a *user* token passes; a service token is refused there. Staging is admin-only, so the
  staging app works for admins only.

### Playback and history

`PlaybackService` is a Media3 `MediaSessionService` around ExoPlayer, so the notification, the
lock screen and Bluetooth drive it with the screen off. It uses music audio attributes, audio
focus, pause-on-unplug and the network wake mode. One `ResolvingDataSource` adds the token to
every request: each range request of a stream, and the artwork the notification draws.
Queue items are rebuilt from their track id in `onAddMediaItems`, so a controller never
chooses a URL. Any media controller on the device can drive playback (that is what a media
session is for); none can read a token through it.

The history ledger is written **from the service** (`HistoryRecorder` → `ListenLedger`), so a
listen counts with the UI closed. It follows the web player's `flushSession`: one row per track
per playing stretch, at least 1 s, closed on pause, on a track change (completed when the
player moved on by itself) and when the app goes to the background (then reopened). The
`context` is `album/…`, `artist/…` or `station/<seed>`, encoded exactly as JavaScript's
`encodeURIComponent`. `PlayContext.kt` does it in plain Kotlin, and
`native/play-context-cases.json` holds the vectors that both its JVM test and the server's own
`parsePlayContext` (in `check:native`) pass. A context longer than the server's 600 characters
is dropped, not sent: the server would refuse the whole row.

### The screens

Sign-in → **Library** (Albums: a cover grid with sort and search, paged 120 at a time; Artists)
→ **Artist** (their albums) → **Album** (tap a track: the album plays from there) → a mini
player bar and **Now Playing** (cover, seek bar, previous/play/next, **Start radio** from the
current track: it keeps playing and the station becomes the rest of the queue) → **Account**
(who, which environment, sign out). Edge-to-edge with `safeDrawing` insets. Back is the app's
own stack plus `BackHandler`, with no navigation library. Icons are hand-drawn `ImageVector`s,
and covers are `HttpURLConnection` + `BitmapFactory` + an `LruCache`, with no image library.

### What hasn't been seen yet

**It has never been built by Gradle or run on a device.** The session that wrote it couldn't reach
Google's Maven repository. Before the first build, `gradle/verification-metadata.xml` must be
regenerated (§ 6 below) and its new checksums reviewed. What *was* checked: the 17 JVM tests
(PKCE against RFC 7636's own vector, redirect parsing, the ledger, the JSON shapes, the play
context vectors), and all 15 sources compiled by kotlinc 2.2.10 with the Compose compiler
plugin against the API 36 framework, Compose 1.7 and Guava, with stubs for Media3, activity
and browser. A wrong Media3 signature would therefore only show up in the first real build.

## 6 · Building

```bash
pnpm native:gen                         # after editing shells.js or a start app's web manifest
pnpm android:build                      # staging APKs → native/android/out/*-staging.apk
pnpm android:build -- assembleRelease   # production (signed if the keystore env is set)
pnpm android:build -- :home:testDebugUnitTest   # OriginPolicy vs origin-cases.json
pnpm android:build -- :kouros:testDebugUnitTest # KourOS Alpha's pure core vs play-context-cases.json
pnpm android:build -- :kouros:assembleDebug     # → out/kouros-alpha-0.1.0-staging.apk
```

`build.mjs` uses the **local SDK** when `JAVA_HOME` and `ANDROID_HOME` are set, otherwise
**Docker** (`--local`/`--docker` force one). Both use the same toolchain, installed by the same
`toolchain.mjs`, and share `native/android/.gradle-home` and `.android-home` (gitignored). The
second holds the **debug signing key**, so staging APKs from either path install over each other.

```bash
node native/android/toolchain.mjs install ~/Android/jkos --adb   # no sudo; one directory
eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"
```

**Bumping an Android dependency** (in `gradle/libs.versions.toml`) means regenerating the
checksums, or the build refuses the new artifact, which is the point:

```bash
cd native/android && ./gradlew --write-verification-metadata sha256 \
  assembleDebug assembleRelease :home:testDebugUnitTest :kouros:testDebugUnitTest
# review the diff: every new sha256 is a new thing you are trusting
```

**Desktop** needs Node ≥ 22.12 (Electron's tooling). The suite runs 20, so this package sits
outside the workspace with its own lockfile:

```bash
cd native/desktop
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm install --ignore-workspace      # the flag is required: see TRAPS.md
pnpm dist                            # → out/jkos/*.deb, out/kouros/*.deb
```

**.deb only, never an AppImage.** Ubuntu 24.04+ blocks unprivileged user namespaces, so
Chromium's sandbox needs an AppArmor profile, which the `.deb` installs. An AppImage can't carry
one and only runs with `--no-sandbox`. For the same reason, `pnpm start` (an unpackaged run)
**crashes on Emily**: the dev Electron binary has no profile. Test through the installed `.deb`,
or give the dev binary a profile as root. Don't add `--no-sandbox`.

## 7 · What holds it

| Check | Where | What |
|---|---|---|
| `pnpm check:native` | `native/gen-native.mjs --check` + `test/native.mjs` | generated files in sync (and no stale variant dirs, and jkAuth's `native-clients.json`); desktop policy vs origin-cases; webPreferences, permissions, external schemes; main.js applies the policy; fuses; .deb-only; manifests least-privilege; no `addJavascriptInterface`/`proceed()`/file access/mixed content; signing from env; wrapper, dependencies, toolchain and image pinned; staging URLs routed; **KourOS Alpha (§ 7 of the test):** exactly four permissions, exactly three exported components, the redirect filter's scheme = `${applicationId}`, no WebView, tokens written only Keystore-sealed into `noBackupFilesDir`, every refresh under the Mutex, store-before-use, the state check, no redirect following, Bearer only to `api_base`, play-context vectors vs the server's parser |
| `apps/jkauth/test/native.mjs` | `npm test` in jkAuth (gate step 2) | the native sign-in, over real HTTP: dead-end refusals, the login round trip, consent bound to person and request, the scheme in `form-action`, codes single-use / verifier-bound / short-lived / replay-burns, refresh rotation + 409 race + reuse burn, the transport binding both ways (and its triggers), the Bearer gate, revoke, the audit trail, off when `JKOS_NATIVE_ENV` is unset |
| Gradle unit test | `:kouros:testDebugUnitTest` | PKCE (RFC 7636 vector), redirect parsing, `ListenLedger`, JSON shapes, `PlayContext` vs play-context-cases |
| `pnpm check:nginx` | `infra/nginx/gen-nginx-weave.mjs --check` | every origin a TWA trusts serves `/.well-known/assetlinks.json` |
| `pnpm check:audit` | `test/supply-chain.mjs` | **every tracked** `pnpm-lock.yaml`, so the desktop's too, at the `high` floor |
| Gradle unit test | `:home:testDebugUnitTest` | `OriginPolicy` vs origin-cases (not on the node gate: it needs the JDK) |
| Gradle verification | `gradle/verification-metadata.xml` | a tampered or unexpected artifact fails the build |

Each `check:native` assertion was seen to fail on a mutated copy before it was trusted.

## 8 · Adding a shell

1. Add a row to `SHELLS` in `native/shells.js`. Its `start` app needs a web manifest with 512 px
   `any` and `maskable` PNGs and a `theme_color`.
2. `pnpm native:gen`. A TWA becomes a new flavor automatically. A second `home` shell isn't
   supported (the generator refuses it). A **native** shell (`android: 'native'`, plus a
   `channel`) needs its own module at `native/android/<start>/` (copy `kouros/`'s shape), and
   its client lands in jkAuth's `native-clients.json`. Deploying jkAuth is what lets it sign in.
3. For a TWA: `pnpm android:signing`, which adds its package to `assetlinks.json`. Then
   `node infra/nginx/gen-nginx-weave.mjs` and deploy.
4. `pnpm check:native && pnpm check:nginx`. For a desktop shell, `pnpm dist` picks it up.
