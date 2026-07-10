# jkOS — Operations

Build, run, deploy, cold start. Host: TrueNAS SCALE (ZFS pool `Luna`), dev machine Emily.

## Local development

```bash
pnpm install                        # one workspace install (root)
pnpm dev                            # turbo run dev (all apps)
pnpm build                          # turbo run build
pnpm --filter @jkos/<app> build     # one app (ordeck | beigeboard)
pnpm --filter @jkos/<app> dev
```

Per-app typecheck: ORDECK `tsc --noEmit`; BeigeBoard `tsc -b`.
Frontends read `VITE_JKOS_AUTH_URL` (default `https://auth.jkos.net`; dev proxies to `:3100`).
After editing `packages/*`, run `pnpm install` to re-inject workspace packages into consumers.

## Contract gate

Before pushing: `pnpm test:contracts`. One chain covering every hard contract — auth
contracts + the node↔python bridge, the jkAuth/BeigeBoard/LazurOS/PapyrOS behavioural
smokes, the weave + lego tests, the write round-trip, seven static conformance checks
(tokens/nginx/responsive/drag/cards/hud/docker), and the suite prober (fails on `drift`). A
failure means a cross-system contract has drifted — fix the source of truth, not the test.
Full anatomy + per-app runners: [TESTING.md](TESTING.md); command catalog:
[PRIMITIVES.md](PRIMITIVES.md). Post-deploy:
`pnpm prove --live https://staging.jkos.net` smokes the deployed edge.

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
| lazuros | host | 8080 | internal |
| staging-* + jkos-deploy | nginx-staging-proxy | — | staging.jkos.net |

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
   as of commit `4cba7f8` this self-heals a missing bind-mount by recreating the container
   instead of a bare restart, before falling back to `docker restart standalone-nginx`).
   **Prod deploy always skips nginx** (`MANAGE_NGINX=0`) — standalone-nginx mounts its config
   from the staging checkout; a prod deploy must not restart it with unvalidated config.

**Branch model:** `staging` is the deployable branch. `PROD_BRANCH=staging` in
`jkos-deploy/docker-compose.yml` means "Promote to Production" ships exactly what staging ran.
Flip to `main` to restore a merge-gated flow. The controller cannot redeploy itself — it runs
as an isolated Compose project; rebuild it manually from the TrueNAS host.

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

- `reload_nginx()` in `infra/scripts/lib-deploy.sh` (the deploy pipeline's nginx step, used
  by both the "Deploy Staging" and staging-owned nginx changes) now **self-heals exactly
  this** as of commit `4cba7f8`: before touching the running container it diffs every
  `include` path `standalone.conf` declares against what the live `standalone-nginx`
  container actually has mounted; if anything is missing it recreates the container via
  `docker compose up -d` against `infra/nginx/docker-compose.yml` (re-verifying afterward),
  and only falls back to a plain `docker restart standalone-nginx` when nothing was missing.
  So the deploy pipeline no longer needs a human to notice and recreate manually — but a
  manual, ad-hoc `docker restart standalone-nginx` run outside the pipeline still carries the
  full risk above and should be treated as unsafe whenever the mounted conf set might have
  drifted.

  **This happened for real on 2026-07-09**: the live `standalone-nginx` container predated
  the `apps-generated*.conf` bind-mounts, so `/papyros` silently fell through to the ORDECK
  portal's `location /` instead of PapyrOS's subpath — a routing/mount-drift bug, not a
  code bug, and the reason `reload_nginx`'s self-heal exists.

## Staging

Path-routed under `staging.jkos.net` on the `nginx-staging-proxy` network. Root (`/`) →
staging ORDECK. Paths: `/auth/`, `/beigeboard/`, `/deploy/`.

The shell is built with `VITE_JKOS_AUTH_URL=https://staging.jkos.net` (same-origin auth).
Admin gate: every location runs `auth_request` → prod `jkos-auth /auth/require-admin`. Prod
must be healthy before staging's gated routes work.

Because of that gate, an **unauthenticated** `pnpm prove --live https://staging.jkos.net`
reports `drift` on every app's health/capabilities checks (302 → prod login) — this is
expected staging behaviour, not a regression. Re-run with `--token <admin jwt>` (or
`PROBE_TOKEN=`) for a clean signal.

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

Use DNS-only (grey cloud) for Cloudflare origin-cert TLS, or Full (Strict) with proxying.

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
| jkAuth | `apps/jkauth/.env` | `JKOS_AUTH_PRIVATE_KEY`, `JKOS_AUTH_PUBLIC_KEY`, `COOKIE_DOMAIN`, `AUTH_ORIGIN`, `PORTAL_URL`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `ADMIN_SEED_EMAIL/PASSWORD` |
| BeigeBoard | `apps/beigeboard/.env` | `JKOS_AUTH_PUBLIC_KEY`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `LAZUROS_URL`, `LAZUROS_TOKEN`, `CALENDAR_ENC_KEY` |
| ORDECK | `apps/ordeck/.env` | build-time `VITE_JKOS_AUTH_URL` (prod default baked in) |

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | jkauth + beigeboard | Separate OAuth apps (different redirect URIs). |
| `LAZUROS_TOKEN` | lazuros, beigeboard | Shared static bearer for server-to-server LazurOS calls. |
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

`standalone.conf` and its four generated includes are file bind mounts. `git reset --hard`
replaces the inode; `nginx -s reload` re-reads the old (stale) inode — never relied on. A
bare `docker restart standalone-nginx` refreshes already-mounted inodes but **cannot add a
new bind-mount**, so it's only safe when the mounted conf set hasn't changed; otherwise
RECREATE (`cd infra/nginx && docker compose up -d`). Full anatomy, the self-healing
`reload_nginx()`, and the 2026-07-09 incident it fixed: § Nginx config above. The deploy
controller runs this automatically on staging deploys where `infra/nginx` changed; prod
deploys skip nginx entirely.

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
