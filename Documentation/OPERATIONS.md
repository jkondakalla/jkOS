# jkOS — Operations

Build, run, deploy, cold start. Host: TrueNAS SCALE (ZFS pool `Luna`), dev machine Emily.

## Local development

```bash
pnpm install                        # one workspace install (root)
pnpm dev                            # turbo run dev (all apps)
pnpm build                          # turbo run build
pnpm --filter @jkos/<app> build     # one app (ordeck|beigeboard|sylibos)
pnpm --filter @jkos/<app> dev
```

Per-app typecheck: ORDECK `tsc --noEmit`; BeigeBoard/SylibOS `tsc -b`.
Frontends read `VITE_JKOS_AUTH_URL` (default `https://auth.jkos.net`; dev proxies to `:3100`).
After editing `packages/*`, run `pnpm install` to re-inject workspace packages.

## Docker build model

Every JS image builds from the **repo root context** so `@jkos/*` is visible. Each
`apps/<svc>/docker-compose.yml` sets `build.context: ../..`. Never revert to a per-app context.

```dockerfile
COPY . .
RUN pnpm install --frozen-lockfile --filter <pkg>...
RUN pnpm --filter <pkg> build          # frontends (Vite)
RUN pnpm --filter <pkg> deploy --prod  # backends → self-contained bundle
```

Python images (LazurOS) keep their own per-app context.

## Compose / ports

Root `docker-compose.yml` (`include:` each `apps/<svc>/docker-compose.yml`) is prod.
`docker-compose.staging.yml` is staging. nginx is separate and owns both Docker networks.

| Container | Net | Port | Behind |
|-----------|-----|------|--------|
| standalone-nginx | jkos-internal + nginx-staging-proxy | 80/443 | — (edge) |
| ordeck-shell | jkos-internal | 80 | jkos.net |
| jkos-auth | jkos-internal | 3100 | auth.jkos.net |
| bb-app | jkos-internal | 3001 | beigeboard.jkos.net |
| sylibos-frontend / sylibos-api | jkos-internal | 80 / 8004 | sylibos.jkos.net |
| lazuros | host | 8080 | internal |
| staging-* + jkos-deploy | nginx-staging-proxy | — | staging.jkos.net |

## Deploy (jkos-deploy)

Controller at `staging.jkos.net/deploy/` (admin-gated). Two actions:

- **Deploy Staging** — syncs the staging checkout from `origin/staging`, rebuilds, verifies.
- **Promote to Production** — runs the same pipeline against the prod checkout (`origin/staging`
  by default, so exactly the commit just tested on staging).

Both run through `infra/scripts/lib-deploy.sh` (sourced by `deploy-staging.sh` /
`deploy-prod.sh` / `promote.sh`). The shared routine:

1. Copies the scripts to a tmp dir and re-execs — so `git reset --hard` can't corrupt the
   running shell mid-flight.
2. `git -c 'safe.directory=*' fetch origin && reset --hard origin/<branch>`.
3. `docker compose up --build -d`.
4. `verify_containers` — sleeps 5 s, then inspects every container; fails the deploy if any
   is not `running` (or is `unhealthy`). Green = actually running, not just started.
5. nginx step: **staging only** (`MANAGE_NGINX=1`) and only when `infra/nginx` changed —
   validates the config in a throwaway container, then `docker restart standalone-nginx`.
   **Prod deploy always skips nginx** (`MANAGE_NGINX=0`) — standalone-nginx mounts its config
   from the staging checkout; a prod deploy must not restart it with unvalidated config.

**Branch model:** `staging` is the deployable branch. `PROD_BRANCH=staging` is set in
`jkos-deploy/docker-compose.yml`, so "Promote to Production" deploys the exact commit tested
on staging. Flip `PROD_BRANCH` to `main` to restore a merge-gated flow. `main` is a stable
marker updated from a dev machine.

## Staging

Path-routed under `staging.jkos.net` on the `nginx-staging-proxy` network. Root (`/`) →
staging ORDECK shell. Paths: `/auth/`, `/beigeboard/`, `/sylib/`, `/sylib/api/`, `/deploy/`.

The shell is built with `VITE_JKOS_AUTH_URL=https://staging.jkos.net` (same-origin auth).
HUD data feeds use the same absolute paths as prod (`/api/lazuros/`, `/api/bb/`, etc.) but
routed to staging upstreams — the same shell image works in both environments.

Admin gate: every location runs `auth_request` → prod `jkos-auth /auth/require-admin`. Start
prod first; staging returns 502 on gated routes until prod jkAuth is healthy. `set $upstream`
returns 503 gracefully when a staging service is down.

---

## Cold start (from zero)

### Prerequisites

**DNS** — A records pointing to your server's public IP:

| Record | Notes |
|--------|-------|
| `jkos.net` (apex) | |
| `auth.jkos.net` | |
| `beigeboard.jkos.net` | |
| `sylibos.jkos.net` | |
| `staging.jkos.net` | |

Use DNS-only (grey cloud) for Cloudflare origin-cert TLS, or Full (Strict) with proxying.

**SSL** — Cloudflare origin cert (wildcard `*.jkos.net` + apex, 15-year) as flat files:

```bash
mkdir -p /mnt/Luna/Backends/ssl
cp chain.pem /mnt/Luna/Backends/ssl/cert.pem && chmod 644 /mnt/Luna/Backends/ssl/cert.pem
cp key.pem   /mnt/Luna/Backends/ssl/key.pem  && chmod 600 /mnt/Luna/Backends/ssl/key.pem
```

**Data directories:**

```bash
for svc in jkos-auth beigeboard sylibos; do
  mkdir -p /mnt/Luna/Backends/{Production,Staging}/$svc-data
done
mkdir -p /mnt/Luna/Backends/Production/nginx-logs
```

**RS256 keypair** — generate once. Private key goes in jkAuth only; public key in every backend.

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

Copy `.env.example` → `.env` and fill in values for each app. Key required vars:

| Service | File | Key vars |
|---------|------|----------|
| jkAuth | `apps/jkauth/.env` | `JKOS_AUTH_PRIVATE_KEY`, `JKOS_AUTH_PUBLIC_KEY`, `COOKIE_DOMAIN`, `AUTH_ORIGIN`, `PORTAL_URL`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `ADMIN_SEED_EMAIL/PASSWORD` |
| BeigeBoard | `apps/beigeboard/.env` | `JKOS_AUTH_PUBLIC_KEY`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `LAZUROS_URL`, `LAZUROS_TOKEN`, `CALENDAR_ENC_KEY` |
| SylibOS | `apps/sylibos/backend/.env` | `JKOS_AUTH_PUBLIC_KEY`, `LAZUROS_URL`, `LAZUROS_TOKEN` |
| LazurOS | `apps/lazuros/.env` | `LAZUROS_TOKEN`, `JKOS_AUTH_PUBLIC_KEY`, `COMPUTE_NODE_IP`, `COMPUTE_NODE_MAC` |
| ORDECK | `apps/ordeck/.env` | `JKOS_AUTH_PUBLIC_KEY`, `LAZUROS_URL`, `LAZUROS_TOKEN` |

Staging reads the same `.env` files; staging-specific overrides come from `docker-compose.staging.yml`. Copy to the staging checkout:

```bash
for app in jkauth beigeboard lazuros ordeck; do
  cp /mnt/Luna/Webhost/jkOS/apps/$app/.env \
     /mnt/Luna/Webhost/jkOS-staging/apps/$app/.env
done
cp /mnt/Luna/Webhost/jkOS/apps/sylibos/backend/.env \
   /mnt/Luna/Webhost/jkOS-staging/apps/sylibos/backend/.env
```

### Start order

nginx must be first — it creates both Docker networks that all other services join.

```bash
# 1. nginx
cd /mnt/Luna/Webhost/jkOS/infra/nginx && docker compose up -d

# 2. Production (first build: 5–15 min)
cd /mnt/Luna/Webhost/jkOS && docker compose up -d --build

# 3. Staging (optional; prod must be healthy first for the admin gate)
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

nginx is bind-mounted from the **staging checkout** (`/mnt/Luna/Webhost/jkOS-staging/infra/nginx/standalone.conf`). Edit that copy when changing proxy config.

## Secrets

Every service reads from a `.env` file (gitignored). `.env.example` in each app is the reference.

| Variable | Where | Notes |
|----------|-------|-------|
| `JKOS_AUTH_PRIVATE_KEY` | `apps/jkauth/.env` only | RS256 private key, inline `\n`. Never in any other app. |
| `JKOS_AUTH_PUBLIC_KEY` | every backend + jkauth | Required by `@jkos/auth-middleware`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | jkauth + beigeboard | Separate OAuth apps (different redirect URIs). |
| `LAZUROS_TOKEN` | lazuros, beigeboard, sylibos, ordeck | Shared static bearer for server-to-server calls. |
| `CALENDAR_ENC_KEY` | `apps/beigeboard/.env` | 64 hex chars → AES-256-GCM encryption of calendar OAuth tokens at rest. Without it, tokens are stored plaintext (safe no-op fallback). Generate: `openssl rand -hex 32`. |

Gitignored globally: `.env*`, `*.pem`, `*.key`, `*.db`.

---

## Gotchas

### pnpm + Docker + TrueNAS ZFS → `ERR_PNPM_EAGAIN`

`copy_file_range` throws `EAGAIN` under Docker overlay-on-ZFS. Fix already in root `.npmrc`:

```ini
package-import-method=hardlink
```

Keep `UV_USE_IO_URING=0` in Dockerfiles as well. Do **not** add `child-concurrency=1` — it makes cold builds ~6× slower without fixing the root issue.

### nginx lazy upstreams (`set $upstream`)

All `proxy_pass` directives use the variable pattern to defer hostname resolution:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
set $upstream http://ordeck-shell:80;
proxy_pass $upstream;
```

A literal `proxy_pass` hostname fails nginx startup if that container is down. Mandatory for every location block.

### nginx config bind-mount inode pinning

`standalone.conf` is a single-file bind mount. `git reset --hard` replaces the inode; `nginx -s reload` re-reads the old (stale) inode. Always `docker restart standalone-nginx` when the config changes. The deploy controller handles this automatically on staging deploys where `infra/nginx` changed; prod deploys skip nginx entirely (`MANAGE_NGINX=0`).

### git on TrueNAS — mode-bit / lock failures

POSIX_RESTRICTED ACLs cause mode-bit churn and lock `git config`. Always use:

```bash
git -c core.fileMode=false reset --hard origin/<branch>
```

Never run `git config core.fileMode false` — it hangs on the lock.

### git on TrueNAS — dubious ownership in bind-mounted checkouts

When git runs inside a container that mounted the repo, the file uid differs from the
process uid and git refuses with "dubious ownership". Use `safe.directory=*` to whitelist:

```bash
git -c 'safe.directory=*' -C /path/to/repo fetch origin
```

**The single quotes are required in zsh** — without them, `*` glob-expands against the cwd
and the flag is passed as multiple nonsense arguments. `lib-deploy.sh` uses a quoted array
(`GIT=(git -c 'safe.directory=*')`) for the same reason.

### Unlabeled pre-existing networks

If `docker compose up` refuses a network, check `docker network inspect <name>`. If `Labels`
is empty, `docker network rm` it and let compose recreate it.

### Data volume permissions

If a container exits with permission errors on `/data`, ensure the host directory is owned by
the user the container runs as (Node alpine images use uid 1000):

```bash
chown -R 1000:1000 /mnt/Luna/Backends/Production/jkos-auth-data
```

---

## Verification (after changes)

1. `pnpm build` (or `--filter @jkos/<app>`) green.
2. Per-app `tsc` green.
3. `docker compose build` from root — the real gate that shared-package resolution works in images.
4. Log in, change theme → confirm mode + accent apply identically in all frontends; reload persists (proves `PATCH /auth/profile` round-trip).
