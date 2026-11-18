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
| **jkOS Alpha** | `net.jkos.app.alpha` | Android | native (Compose + Media3) | ORDECK | BeigeBoard's and KourOS's APIs + jkAuth, by Bearer token |

KourOS is part of jkOS **and** its own app (Plex and Plexamp): its own icon, its own entry in
recents, and `kouros.jkos.net` links open in it. jkOS Home is ORDECK as a home panel on a
dedicated tablet or phone, as a kiosk (see [below](#jkos-home--the-launcher)). KourOS Alpha is
KourOS rebuilt as a **native** app, for testing (see [below](#5--kouros-alpha--the-native-app)).
Its version carries the channel (`0.1.0-alpha`).

A **debug build is a staging build**: package `<id>.staging`, name "… (staging)", pointed at
`staging.jkos.net`. It installs beside the release app, never over it.

---

## 1 · Layout

```
native/
├── shells.js              THE list of shells — one row each. Everything below derives from it.
├── gen-native.mjs         projects shells.js into the generated files (--check in the gate)
├── origin-cases.json      the navigation rule, as test vectors both implementations pass
├── android/               one Gradle project (AGP 9.4, Gradle 9.8, JDK 21, compileSdk 37, targetSdk 36)
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
│   └── ordeck/            :ordeck — jkOS Alpha, the native app (Kotlin + Compose + Media3)
│       ├── src/<debug|release>/res/          GENERATED: api_apps + api_bases, auth_origin, client_id, redirect_uri
│       └── src/main/java/net/jkos/app/alpha/ the shell; one package per app beneath it:
│           auth/ (jkAuth: sign-in, the session, the one API client), kouros/, beigeboard/, ordeck/
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
  and Gradle read. From API 37 the SDK names a platform with a minor version (`android-37.0`),
  so `platform` names the package the installer lays down, and the installer refuses one that
  isn't a platform of `compileSdk`. AGP maps `compileSdk = 37` to that directory. compileSdk is
  37 because Compose 1.12 requires it; targetSdk, the runtime behaviour, stays 36. **The version** (`VERSION` in `shells.js`) sets Android's `versionName` and
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

> **Being rebuilt as jkOS Alpha (TODO §10).** This section still describes the KourOS screens
> and the sign-in, which are unchanged, and is rewritten from the code at phase J. What has
> changed since it was written:
>
> - **One app for the suite.** Package `net.jkos.app.alpha`, module `native/android/ordeck`
>   (named after its start app), jkAuth client `app: 'ordeck'`. Consent rests on ORDECK being
>   in the person's `aud`: a user or an admin, not a guest.
> - **One API base per reached app**, derived by `nativeConfig()` and generated into `shell.xml`
>   as `api_apps` / `api_bases`. `AppApi` (in `auth/`) is the one client: it attaches the token
>   only to URLs under its own app's base. Where this section says `api_base`, read "KourOS's
>   base".
> - **One Kotlin package per app** under `net.jkos.app.alpha`, and every `/api/…` path an app's
>   package types is a route that app declares, or is on `check:native`'s named list.
> - **The Account tab is jkAuth's**: the display name and the theme mode through
>   `/auth/profile`, the devices list and sign-out-a-device through `/auth/sessions`, each with
>   the app's Bearer token (`AccountApi`). The app marks "this device" by the `family_id` the
>   token endpoint returned. The theme mode is the suite's own `preferences.theme.mode`, drawn
>   as the paper or dark face from hub.css's computed values. Password and two-factor stay
>   jkAuth's own pages, opened in a Custom Tab.
> - **One transport holds the token** (`BearerClient`): `AppApi` builds one for
>   `${an app's base}/api/`, `AccountApi` one for `${auth_origin}/auth/`, and `HealthApi` one
>   per derived health probe, on a staging build only (`health_bearer`: the staging edge gates
>   the probes; production's are open). Nothing else may.
> - **KourOS's lists (phase G1):** search, the queue and playlists. A playlist's tracks are
>   read by id (`/api/tracks?ids=`, in pieces of Weave's `IN_MAX`), never by pulling the
>   catalog. The queue is Media3's own, so every edit is a player call. Reordering, in the
>   queue and in a playlist, is one grip-bound `ReorderList` over pure `Reorder` arithmetic.
> - **Audiobooks (phase G2):** a book is its files in the queue, one entry each, as
>   `book:<bookId>:<fileIndex>` (`MediaRef`; a bare number is still a track). Each entry's
>   extras carry its book, where it starts in the book, the book's length and its chapters, so
>   the service needs no lookup. `BookLayout` turns a position in the book into a file and an
>   offset. The service's `BookKeeper` saves `progress` (a PATCH of the row by id, a POST only when there
>   is none: the server's upsert gives a POSTed row a new id, which would strand a web tab) every
>   5 s of playing, on pause, on a switch and at the end; sets the device's book rate on a book
>   and 1× on anything else; and fires the `SleepTimer`. A book's listen goes to `book_history`,
>   one stretch across its files. The rate is a device preference in the sealed `prefs.bin`
>   (`Auth.pref`), since `check:native` allows no SharedPreferences.
> - **The listening session (phase G3):** `SessionLink` is the transport: a device id per
>   install in the sealed prefs, registration, and `/api/session/events` read through
>   `BearerClient.stream`, the same one token holder. A cancel closes the connection,
>   since a blocked read notices nothing else. It reconnects with the web's backoff and
>   reopens on `reauth`. `SessionOutput`, in the service, is the output role; `SessionCore`
>   is its pure half, held to `native/session-{mode,state,command}-cases.json`. As a
>   remote, `SessionLink.role` routes the screens' plays (Player.kt) to the output as
>   commands, and `RemoteUi` draws the output's session on the server's clock and edits its
>   queue (jump, remove, reorder, in the session's indices).
> - **BeigeBoard (phase H):** `BeigeBoardApi` over the declared routes, `Items` for the
>   shape and the bodies (each holds only its capability's declared fields; check:native
>   holds them, CONTROLS.md CF-4), and a `Board` holding the items with optimistic writes. Pin
>   and focus are the HUD shelf in jkAuth's preferences (`auth/HudShelf.kt`, through
>   `AccountApi`), read with the web's XC-5 fallback. `Tree` walks goals → lists → tasks and
>   measures progress as the web's getProgress does. Routines and the library (`Routines.kt`):
>   a routine is changed as its document, through the import's dry run and then the import.
>   Every field list and vocabulary the app keeps is held by check:native to its declaration
>   or to `@jkos/routine-spec`.
> - **ORDECK, the Home tab (phase I):** the HUD. `HudOrder` reads the person's arrangement
>   (`preferences.ordeck.hud`) as the web's `loadHudState` + `layoutForBreakpoint` do for the
>   mobile tier, held to them by `native/hud-order-cases.json`. `Slices.kt` ports the web's
>   slices (`useHudData.ts`); `HudModel` reads the profile once (order, shelf, AI switch), holds
>   a `Board` for BeigeBoard's items, and probes each app's health (`HealthApi`, the URLs
>   `shells.js` derives). It refreshes every minute, the probes every 30 s, only while Home is
>   up and the app is in front. Tapping an item opens BeigeBoard's `ItemSheet` over the Home.
> - **A tab exists only for an app in the token's `aud`** (`Tabs.forAud`). The audience is read
>   from the access token and kept in the sealed session file, so the tabs are right at a cold
>   start. Each tab has its own back stack; the mini player sits above the bar.

KourOS as a real Android app: Compose UI, Media3 playback, no WebView, no bundled frontend.
Package `net.jkos.app.alpha` (a debug build is `….staging`, against `staging.jkos.net`), so
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
  token. nginx's `auth_request` forwards the request's `Authorization` header by default, and
  `standalone.conf` says so explicitly (`check:native` § 8 holds the line). Only a *user* token
  passes; a service token is refused there. Staging is admin-only, so the
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

### The look: the web's, not Material's

The app draws in the suite's own visual language, so it reads as jkOS rather than as a stock
Android app. **Compare against the desktop web, not BeigeBoard's `src/mobile/` tree**, which is
stale. Everything lives in `ordeck/…/look/`:

- **`Tokens.kt`** holds both faces' colours, derived the way `hub.css` derives them: the literal
  grounds, inks and lines, and the accent chain computed from the person's own pair
  (`preferences.theme.primary` / `.secondary`) with CSS `color-mix` arithmetic. Paper deepens
  the pair, and the tube shows it raw and makes it glow. It is pure Kotlin.
  **`TokensTest`** holds every token, on both faces, to what Chromium computes from `hub.css`
  (`packages/design/tokens/computed-baseline.json`, written by `test/token-identity.mjs`).
  Change `hub.css`, regenerate the baseline, and the native test fails until the app follows.
- **`Type.kt`** sets up the four typefaces: Fraunces (two optical cuts, text and display), IBM
  Plex Sans, IBM Plex Mono, and Big Shoulders Display for the tube's readouts. They are bundled
  in `res/font` and pinned in `native/android/fonts.json` (upstream commit + sha256, OFL licence
  in `assets/licenses/`). `check:native` § 5 holds every font file to that list. Material's type
  roles are filled from them, so a stock dialog still prints like the suite.
- **`Atmosphere.kt`** paints the ground (`Ground`). Film grain is multiplied into paper and
  screened onto the tube. With halation on there is the rake on paper and the buzz on the tube,
  plus the scan-line veil when the person turns it on. `LocalStill` holds the rake still for
  the renders.
- **`Kit.kt`** holds the primitives, named after `@jkos/ui`'s: `Sheet`, `Chip` (tinted, solid,
  done), `Well`, `Check`, `Bar`, `VU`, `Eyebrow`, `Lab`, `PressTitle` / `Wordmark`, `Seg`,
  `Folio`, `TButton`, `Field`, `Pill`, `Lamp`, `MastTab`, `JkSlider` (the fader) and `Knob` (the
  transport button). Each follows its hub.css recipe: paper presses and debosses, the tube
  glows. **A screen builds from these, never from Material's defaults.** Material components
  that remain (dialogs, menus, switches) take their colours and shapes from the theme.
- **`Look`** (`auth/AccountModels.kt`) is the person's mode, accent pair and effects, read from
  `/auth/profile` as auth-client reads them. A stored colour is drawn, so anything but a hex is
  refused. The last look seen is kept in the sealed prefs file, so the app opens in it.

Render after any visual change, in both faces, and put the renders beside the web's. For the
web side, use `pnpm widget shot --routes <app>` for the widget pages. For the rest, use a
scratchpad mock backend, `vite build` and headless Chromium with `--force-prefers-reduced-motion`.

### What hasn't been seen yet

**It has never run on a device.** Gradle first built it on 2026-11-16, against the real Media3
1.11.1, Compose 1.12.1 and activity 1.13.0, and its 17 JVM tests pass (PKCE against RFC 7636's own
vector, redirect parsing, the ledger, the JSON shapes, the play context vectors). No Media3
signature was wrong.

That first build found two things the source alone couldn't show:

- **Compose 1.12 needs compileSdk 37.** compileSdk moved to 37 (§ 2); targetSdk stays 36.
- **The APK asked for six permissions, not four.** Media3 merges in `ACCESS_NETWORK_STATE`,
  only to guess a bandwidth estimate from the network type, and it catches the
  `SecurityException` when the permission is missing, so the app's manifest removes it.
  androidx.core adds `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, a signature-level
  permission the app defines for itself. It stays: it keeps the app's receivers private on
  Android 8–12, and no other app can hold it. The build now refuses an APK whose merged
  manifest asks for anything else (`checkDebugPermissions` / `checkReleasePermissions`, which
  `assemble` depends on).

## 6 · Building

```bash
pnpm native:gen                         # after editing shells.js or a start app's web manifest
pnpm android:build                      # staging APKs → native/android/out/*-staging.apk
pnpm android:build -- assembleRelease   # production (signed if the keystore env is set)
pnpm android:build -- :home:testDebugUnitTest   # OriginPolicy vs origin-cases.json
pnpm android:build -- :ordeck:testDebugUnitTest # KourOS Alpha's pure core vs play-context-cases.json
pnpm android:build -- :ordeck:assembleDebug     # → out/jkos-alpha-0.1.0-staging.apk
pnpm android:build -- :ordeck:testDebugUnitTest -Pjkos.screens  # → ordeck/build/screens/*.png
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
  assembleDebug assembleRelease :home:testDebugUnitTest :ordeck:testDebugUnitTest
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
| `pnpm check:native` | `native/gen-native.mjs --check` + `test/native.mjs` | generated files in sync (and no stale variant dirs, and jkAuth's `native-clients.json`); desktop policy vs origin-cases; webPreferences, permissions, external schemes; main.js applies the policy; fuses; .deb-only; manifests least-privilege; no `addJavascriptInterface`/`proceed()`/file access/mixed content; signing from env; wrapper, dependencies, toolchain and image pinned; staging URLs routed; **KourOS Alpha (§ 7 of the test):** exactly four permissions, Media3's `ACCESS_NETWORK_STATE` removed, the build's merged-manifest allow-list equal to the four, exactly three exported components, the redirect filter's scheme = `${applicationId}`, no WebView, tokens written only Keystore-sealed into `noBackupFilesDir`, every refresh under the Mutex, store-before-use, the state check, no redirect following, Bearer only to `api_base`, play-context vectors vs the server's parser; **native sign-in (§ 8):** staging jkAuth alone sets `JKOS_NATIVE_ENV`, the edge gate forwards `Authorization`, every native app's staging API base is routed |
| `apps/jkauth/test/native.mjs` | `npm test` in jkAuth (gate step 2) | the native sign-in, over real HTTP: dead-end refusals, the login round trip, consent bound to person and request, the scheme in `form-action`, codes single-use / verifier-bound / short-lived / replay-burns, refresh rotation + 409 race + reuse burn, the transport binding both ways (and its triggers), an S256-shaped challenge held by a CHECK, a role the app doesn't admit refused before consent, the Bearer gate, revoke, the audit trail, off when `JKOS_NATIVE_ENV` is unset and no boot on an unknown value |
| Gradle unit test | `:ordeck:testDebugUnitTest` | PKCE (RFC 7636 vector), redirect parsing, `ListenLedger`, JSON shapes, `PlayContext` vs play-context-cases |
| Token parity | `:ordeck:testDebugUnitTest` (`TokensTest`) | every colour token on both faces equals what Chromium computes from hub.css (`computed-baseline.json`); seen to fail on a changed mix before it was trusted |
| Font pinning | `pnpm check:native` § 5 | every file under a module's `res/font` is in `fonts.json`, matches its sha256, comes from a pinned google/fonts commit, and ships its OFL licence; seen to fail on an unlisted file and on a changed hash |
| Screen renders | `:ordeck:testDebugUnitTest -Pjkos.screens` | `ScreensTest`: the real Compose screens drawn on Robolectric (Roborazzi) from sample data, as PNGs to look at: BeigeBoard's, and KourOS's library, Now Playing and mini player. Test-only dependencies (none reaches an APK); Robolectric's Android runtime is resolved and checksum-pinned by Gradle and loaded offline (`robolectric.offline`), never fetched by Robolectric itself. Out of the normal test run unless asked for. Their first run found two app-wide theme bugs (TRAPS.md § Native shells). |
| `pnpm check:nginx` | `infra/nginx/gen-nginx-weave.mjs --check` | every origin a TWA trusts serves `/.well-known/assetlinks.json` |
| `pnpm check:audit` | `test/supply-chain.mjs` | **every tracked** `pnpm-lock.yaml`, so the desktop's too, at the `high` floor |
| Gradle unit test | `:home:testDebugUnitTest` | `OriginPolicy` vs origin-cases (not on the node gate: it needs the JDK) |
| Gradle verification | `gradle/verification-metadata.xml` | a tampered or unexpected artifact fails the build |
| Gradle permission check | `:ordeck:check<Variant>Permissions`, which `assemble` depends on | the **merged** manifest, the one the APK carries, asks for exactly `ALLOWED_PERMISSIONS` plus androidx.core's signature-level self permission; `check:native` holds that list equal to the source manifest's |

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
