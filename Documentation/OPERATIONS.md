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

**Branch model:** `staging` is the deployable branch. `PROD_BRANCH=staging` in
`jkos-deploy/docker-compose.yml` means "Promote to Production" ships exactly what staging ran.
Flip to `main` to restore a merge-gated flow. The controller cannot redeploy itself — it runs
as an isolated Compose project; rebuild it manually from the TrueNAS host.
`bash jkos-deploy/scripts/selftest.sh` is a read-only dry run of the recovery path (scripts
parse, compose configs validate, nginx conf loads, break-glass gates hold).

### Break-glass access (prod-jkAuth outage)

The `/deploy` console is admin-gated by **prod** jkAuth — so if prod jkAuth is down, you
can't sign in to the one tool that redeploys it (a bootstrap deadlock). Two escape hatches:

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
Admin gate: every location runs `auth_request` → prod `jkos-auth /auth/require-admin`. Prod
must be healthy before staging's gated routes work.

Because of that gate, an **unauthenticated** `pnpm prove --live https://staging.jkos.net`
reports `drift` on every app's health/capabilities checks (302 → prod login) — this is
expected staging behaviour, not a regression. Re-run with `--token <admin jwt>` (or
`PROBE_TOKEN=`) for a clean signal.

---

## Native apps (Android + desktop)

Three Android apps and two Linux desktop apps, all declared in `native/shells.js`. Every one
loads the live site at its real origin, so auth needs **zero changes**. How they're built and
why they're shaped this way is in [agents/NATIVE.md](agents/NATIVE.md); this is the runbook.

| App | Package | What it's for |
|---|---|---|
| **jkOS** | `net.jkos.app` | The suite on your phone (Android) or desktop (Linux). Long-press the Android icon for KourOS / BeigeBoard shortcuts. |
| **KourOS** | `net.jkos.kouros` | Music and audiobooks as their own app (Plexamp to jkOS's Plex). |
| **jkOS Home** | `net.jkos.home` | ORDECK as the home screen of a dedicated tablet or phone. |

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
4. **Keep the keystore.** One key signs all three apps. Lose it and you can never ship an
   upgrade to any of them. Back it up somewhere that isn't this machine; it's deliberately not
   in the repo.

### Android: first release

```bash
# 0. The build toolchain, once. Either give this account Docker, or (no sudo):
node native/android/toolchain.mjs install ~/Android/jkos --adb
eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"

# 1. The release key (asks for a password: yours, recorded in your password manager).
#    Writes net.jkos.app + net.jkos.kouros with its fingerprint into assetlinks.json.
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

# 3. Staging (prod must be healthy first — staging gates against prod jkAuth)
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
