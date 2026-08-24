# KourOS on Android — the TWA

How the music client becomes an app you install from a file, and the traps that
cost the most time to find. Read this before touching `infra/nginx/assetlinks.json`
or running Bubblewrap.

## What a TWA actually is

A **Trusted Web Activity** is a real, signed `.apk` whose entire UI is Chrome
rendering a URL — but with the browser chrome removed, *provided* Chrome can
verify that the app and the origin belong to the same owner. That verification is
the whole mechanism, and it is the only thing standing between "an app" and "a
web page with a URL bar in it".

Two artefacts have to agree:

| Side | Artefact | Says |
|---|---|---|
| The app | `AndroidManifest.xml` `asset_statements` | "I claim `https://kouros.jkos.net`" |
| The origin | `https://kouros.jkos.net/.well-known/assetlinks.json` | "package `<id>` signed with `<SHA-256>` may claim me" |

If either is missing or the fingerprints differ, the app still works — it just
shows a URL bar forever, with no error message anywhere. **Every TWA problem you
will have is this problem.**

## Why we chose it

Considered against the alternatives, given the suite's existing auth:

* **A plain PWA** installs from Chrome but is not a file you can hand someone.
* **Capacitor** would need real work in jkAuth. The whole suite runs on an
  httpOnly `jkos_token` cookie scoped to `.jkos.net`, plus a same-origin nginx
  peer proxy that deliberately has **no CORS surface**. A Capacitor WebView loads
  from `capacitor://localhost`, so the cookie is third-party (blocked), the CORS
  allowlist rejects the origin, and jkAuth mints user tokens **only** through the
  client-credentials grant — there is no user-facing endpoint that returns a JWT
  in a body. All three would have to change.
* **A TWA** runs at the real browser origin, so the cookie, the redirect and the
  same-origin `/api/kouros/` proxy behave exactly as they do on the desktop.
  **Zero auth changes.** That is why it won.

## The four traps

### 1. `.well-known/` cannot be shipped in `public/`

`serveSpa` mounts `express.static`, whose `dotfiles` option defaults to `'ignore'`
— so `.well-known/` never matches — and the `app.get('*')` fallback then answers
with `index.html` at **200**. Measured against the real server before this was
fixed:

```
/.well-known/assetlinks.json  →  status=200  content-type=text/html; charset=UTF-8
```

Android's verifier receives HTML, fails, and reports nothing useful. So the file
is answered **at the edge**, generated into every prod server block from
`infra/nginx/assetlinks.json` by `gen-nginx-weave.mjs`.

### 2. `auth.jkos.net` needs asset links too

Sign-in is a full-page redirect to a **different origin**. An unverified hop puts
a URL bar over the login screen — precisely where a person is typing a password
into something that is supposed to look like an app. jkAuth's block is hand-tuned
in `standalone.conf`, so this is the one place the location exists twice;
`pnpm check:nginx` asserts the two payloads stay identical.

Bubblewrap must also be told, at `init`:

```json
"additional_trusted_origins": ["https://auth.jkos.net"]
```

### 3. The DNS record must be ORANGE-cloud

The origin serves a **Cloudflare Origin Certificate**, which is *not publicly
trusted*. Proxied (orange cloud, Full (Strict)), the phone sees Cloudflare's
Let's Encrypt edge certificate and validates fine. Grey-cloud (DNS-only) exposes
the origin certificate directly and **Android refuses the TWA outright**.

Verify from off-LAN, not from the house:

```bash
curl -sI https://kouros.jkos.net/health
echo | openssl s_client -connect kouros.jkos.net:443 -servername kouros.jkos.net 2>/dev/null \
  | openssl x509 -noout -issuer     # must say Let's Encrypt, NOT Cloudflare Origin CA
```

### 4. Keep the keystore

The fingerprint in `assetlinks.json` is the fingerprint of *your* signing key.
Lose the keystore and you cannot ship an upgrade to the same app — the new
signature will not match, verification fails, and the URL bar comes back. Back it
up somewhere that is not this repo. It is deliberately **not** committed.

## The build

Needs JDK 17 and the Android SDK. Nothing enters the repo except the fingerprint.

```bash
# 1. scaffold from the live manifest (the origin must already be up — see Trap 3)
npx @bubblewrap/cli init --manifest https://kouros.jkos.net/manifest.webmanifest
#    …answer: host kouros.jkos.net, and add the additional trusted origin from Trap 2

# 2. build + sign
npx @bubblewrap/cli build

# 3. take the fingerprint it prints (or read it back out of the keystore)
keytool -list -v -keystore android.keystore -alias android | grep 'SHA256:'
```

Put that fingerprint into `infra/nginx/assetlinks.json`:

```json
{
  "targets": [
    {
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "net.jkos.kouros",
        "sha256_cert_fingerprints": ["AA:BB:…"]
      }
    }
  ]
}
```

Then regenerate, deploy, and **restart** nginx:

```bash
node infra/nginx/gen-nginx-weave.mjs
pnpm check:nginx
# deploy staging (it owns the nginx config), then restart — NOT reload:
# the confs are bind-mounts and a reload will not re-read a replaced inode.
```

Install with `adb install app-release-signed.apk`, or copy the APK to the phone.

## Verifying it worked

The only signal that matters is **no URL bar**. Check in this order:

```bash
# JSON, not HTML — on BOTH origins
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://kouros.jkos.net/.well-known/assetlinks.json
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://auth.jkos.net/.well-known/assetlinks.json
```

Then on the phone, **with Wi-Fi off** so it is really the public path:

- opens full-screen, no URL bar — including *through* the login redirect
- sign-in survives a cold start (the TWA shares Chrome's cookie jar)
- lock the phone → artwork, title, transport and a **moving** scrubber
- Android back from Now Playing collapses the sheet instead of leaving the app
- airplane mode → the shell still opens (the service worker) and fails honestly

If the URL bar is there, it is trap 1, 2, 3 or 4 — in that order of likelihood.
`adb logcat | grep -i digitalasset` will usually name which.

## Related

- `apps/kouros/public/` — manifest, icons, `sw.js` (app-shell only; it never
  touches `/api/`, because audio is Range-served and a naive worker breaks 206).
- `infra/nginx/assetlinks.json` — the source of truth, with the full rationale.
- `Documentation/OPERATIONS.md` — DNS, deploy and the nginx restart rule.
