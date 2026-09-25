# jkOS — Native shells (Android + Linux desktop)

Installable apps that show the suite. **Every one loads the live site at its real origin.**
None bundles a copy of a frontend, so auth, the `.jkos.net` session cookie and the CORS-free
peer proxy work unchanged. A bundled app would run at a local origin (`capacitor://localhost`,
`file://`) where none of them do, which is why Capacitor was rejected for KourOS. For the
operator's runbook (build, sign, install, verify), see
[OPERATIONS.md § Native apps](../OPERATIONS.md#native-apps-android--desktop).

| Shell | Package | Platforms | Kind | Opens on | Keeps inside itself |
|---|---|---|---|---|---|
| **jkOS** | `net.jkos.app` | Android, Linux | TWA / Electron | ORDECK | every suite app with its own origin |
| **KourOS** | `net.jkos.kouros` | Android, Linux | TWA / Electron | KourOS | KourOS + jkAuth |
| **jkOS Home** | `net.jkos.home` | Android | home-screen launcher | ORDECK | every suite app with its own origin |

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
│   └── home/              :home — the launcher (Kotlin)
│       └── src/<debug|release>/res/          GENERATED per build type
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

The generated files are **checked in**, not built inside Gradle: an origin list is a grant, and a
grant should be reviewable in a diff in the exact form the APK will carry it.

## 3 · The trust model

**The origin list is the trust boundary.** Each shell keeps a navigation inside itself only if
it lands on one of its origins. What happens to anything else depends on the shell:

| | Off-list navigation | Page gets | Native code beside the page |
|---|---|---|---|
| TWA (jkOS, KourOS) | Chrome shows its URL bar / opens it in the browser | nothing Chrome doesn't give any site | none |
| Desktop (Electron) | handed to the system browser (`https:`/`http:`/`mailto:` only; never `file:` or a custom scheme) | no Node, no preload, one permission (`clipboard-sanitized-write`) | the main process, which decides by `policy.js` |
| jkOS Home | **refused**: a kiosk doesn't give a guest the browser | the `jkosShell` bridge on the start origin only | the launcher |

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

## 5 · Building

```bash
pnpm native:gen                         # after editing shells.js or a start app's web manifest
pnpm android:build                      # staging APKs → native/android/out/*-staging.apk
pnpm android:build -- assembleRelease   # production (signed if the keystore env is set)
pnpm android:build -- :home:testDebugUnitTest   # OriginPolicy vs origin-cases.json
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
  assembleDebug assembleRelease :home:testDebugUnitTest
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

## 6 · What holds it

| Check | Where | What |
|---|---|---|
| `pnpm check:native` | `native/gen-native.mjs --check` + `test/native.mjs` | generated files in sync (and no stale variant dirs); desktop policy vs origin-cases; webPreferences, permissions, external schemes; main.js applies the policy; fuses; .deb-only; manifests least-privilege; no `addJavascriptInterface`/`proceed()`/file access/mixed content; signing from env; wrapper, dependencies, toolchain and image pinned; staging URLs routed |
| `pnpm check:nginx` | `infra/nginx/gen-nginx-weave.mjs --check` | every origin a TWA trusts serves `/.well-known/assetlinks.json` |
| `pnpm check:audit` | `test/supply-chain.mjs` | **every tracked** `pnpm-lock.yaml`, so the desktop's too, at the `high` floor |
| Gradle unit test | `:home:testDebugUnitTest` | `OriginPolicy` vs origin-cases (not on the node gate: it needs the JDK) |
| Gradle verification | `gradle/verification-metadata.xml` | a tampered or unexpected artifact fails the build |

Each `check:native` assertion was seen to fail on a mutated copy before it was trusted.

## 7 · Adding a shell

1. Add a row to `SHELLS` in `native/shells.js`. Its `start` app needs a web manifest with 512 px
   `any` and `maskable` PNGs and a `theme_color`.
2. `pnpm native:gen`. A TWA becomes a new flavor automatically. A second `home` shell isn't
   supported (the generator refuses it).
3. For a TWA: `pnpm android:signing`, which adds its package to `assetlinks.json`. Then
   `node infra/nginx/gen-nginx-weave.mjs` and deploy.
4. `pnpm check:native && pnpm check:nginx`. For a desktop shell, `pnpm dist` picks it up.
