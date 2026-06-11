# jkOS — Operations

Build, run, deploy, staging. Host: TrueNAS SCALE (ZFS pool `Luna`), dev machine "Emily".

## Local development

```bash
pnpm install                 # one workspace install (root). Native build scripts
                             # (bcrypt, better-sqlite3, esbuild) are allow-listed in
                             # root package.json → pnpm.onlyBuiltDependencies.
pnpm dev                     # turbo run dev (all apps)
pnpm build                   # turbo run build
pnpm --filter @jkos/<app> build    # one app (ordeck|beigeboard|sylibos)
pnpm --filter @jkos/<app> dev
```

Per-app typecheck: ORDECK `tsc --noEmit`; BeigeBoard/SylibOS `tsc -b`.
Frontends read `VITE_JKOS_AUTH_URL` (default `https://auth.jkos.net`; dev proxies to `:3100`).

## Docker build model (important)

Every **JS** image builds from the **repo root context** so the pnpm workspace
(`packages/@jkos/*`) is present. Each `apps/<svc>/docker-compose.yml` sets
`build.context: ../..` + `build.dockerfile: apps/<svc>/…`. Pattern:

```dockerfile
COPY . .                                            # root context (.dockerignore prunes)
RUN pnpm install --frozen-lockfile --filter <pkg>...
RUN pnpm --filter <pkg> build                       # frontends (Vite)
RUN pnpm --filter <pkg> deploy --prod /out          # backends → self-contained bundle
```
Backends use `pnpm deploy` so the workspace dep `@jkos/auth-middleware` is injected
into the runtime image. LazurOS/Python images keep their own (`apps/lazuros`) context.

> **Do not** revert any app to a per-app build context — `@jkos/*` would be invisible
> and the build fails (this was the original breakage that motivated the monorepo).

## Compose / ports

Root `docker-compose.yml` (`include:` each `apps/<svc>/docker-compose.yml`) is prod;
`docker-compose.staging.yml` is staging. nginx is separate (owns the networks).

| Container | Net | Port | Behind |
|-----------|-----|------|--------|
| standalone-nginx | jkos-internal + nginx-staging-proxy | 80/443 | — (edge, Cloudflare origin cert) |
| ordeck-shell | jkos-internal | 80 | jkos.net |
| jkos-auth | jkos-internal | 3100 | auth.jkos.net |
| bb-app | jkos-internal | 3001 | beigeboard.jkos.net |
| sylibos-frontend / sylibos-api | jkos-internal | 80 / 8004 | sylibos.jkos.net (`/api`,`/health`→api) |
| lazuros | host | 8080 | internal |
| staging-* , jkos-deploy | nginx-staging-proxy | — | staging.jkos.net |

## First-run order

```bash
cd infra/nginx && docker compose up -d            # creates jkos-internal + nginx-staging-proxy
cd <repo root>  && docker compose up -d --build   # all prod services (root include)
```
nginx must be up first (it owns both networks). Add a service = new `apps/<svc>/` +
its compose joining `jkos-internal` + one `include:` line in the root compose.

## Deploy (jkos-deploy)

Controller at `staging.jkos.net/deploy/` (admin-gated). Per environment it runs:
```bash
git -C <DIR> fetch origin
git -C <DIR> reset --hard origin/<branch>          # main = prod, staging branch = staging
docker compose [-f docker-compose.staging.yml] up --build -d
```
Now that the suite is one repo, `<DIR>` is the repo root and the root `include:` compose
builds every service — consistent with the deploy model.

## Staging

- Mirrors prod under `staging.jkos.net` via **path routing** (not subdomains), same
  `standalone-nginx`, on the `nginx-staging-proxy` network. `set $upstream` proxy_pass
  returns 503 gracefully when staging is down.
- Paths: `/auth/`→staging-jkos-auth, `/beigeboard/`→staging-bb-app, `/sylib/`→staging-sylibos-frontend, `/sylib/api/`→staging-sylibos-api, `/deploy/`→jkos-deploy. Root → `/deploy/`.
- **Admin gate:** every staging location runs `auth_request` → `jkos-auth /auth/require-admin`
  (prod auth). 401→login redirect, 403→forbidden.
- Staging containers verify JWTs with issuer **`jkos-auth-staging`** (set in each
  `docker-compose.staging.yml`); cookies scoped to `staging.jkos.net`.

## TrueNAS paths

| Purpose | Path |
|---------|------|
| Repo (prod) | `/mnt/Luna/Webhost/jkOS/` |
| Repo (staging checkout) | `/mnt/Luna/Webhost/jkOS-staging/` |
| Prod data volumes | `/mnt/Luna/Backends/Production/<svc>-data` |
| Staging data volumes | `/mnt/Luna/Backends/Staging/<svc>-data` |
| nginx SSL (CF origin cert) | `/mnt/Luna/Backends/ssl/` — `cert.pem` (644) + `key.pem` (600), mounted as `/etc/nginx/ssl` |
| nginx access/error logs | `/mnt/Luna/Backends/Production/nginx-logs/` |

All data directories live under `/mnt/Luna/Backends/` with prod and staging isolated by
sub-folder. SSL lives at the `Backends/` root (shared by both envs).
ACLs: `truenas_admin:truenas_admin`, `POSIX_RESTRICTED` inheritance.

## Secrets / environment files

Every service reads config from a `.env` file (gitignored at root and per-app).
`.env.example` files are the canonical reference — copy one to `.env` and fill in values.

| Variable | Where | Notes |
|----------|-------|-------|
| `JKOS_AUTH_PRIVATE_KEY` | `apps/jkauth/.env` only | RS256 private key, inline `\n`. Never in any other app. |
| `JKOS_AUTH_PUBLIC_KEY` | every backend `.env` + jkauth | RS256 public key. Required by `@jkos/auth-middleware`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `apps/jkauth/.env` | OAuth2 app from Google Cloud Console. |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` | `apps/jkauth/.env` | Optional; auto-creates first admin on first boot. |

**Gitignored globally:** `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `*.db`,
`.git-backups/`. See root `.gitignore`. `.claudeignore` mirrors these so Claude never reads secret files.

## TrueNAS / Docker gotchas

Learned in production — all fixed in repo as of 2026-06-11.

### pnpm in Docker on TrueNAS ZFS → `ERR_PNPM_EAGAIN`

`copy_file_range` throws spurious `EAGAIN` under Docker overlay-on-ZFS. pnpm hits it
when copying packages from its content store into the image. **Fix** already in root
`.npmrc`:

```ini
package-import-method=hardlink   # uses link() not copyfile; ZFS-safe
```

`UV_USE_IO_URING=0` (also set in Dockerfiles) does **not** fix this alone — io_uring was
already off. Keep both. Also keep `child-concurrency=1` + `force-legacy-deploy` that were
added earlier for related ZFS symptoms.

### nginx upstreams must be lazy (`set $upstream`)

`proxy_pass http://ordeck-shell:80` resolves the hostname at config load. If the upstream
container is down, nginx refuses to start at all — taking the edge down with it. All prod
and staging `proxy_pass` entries use the resolver pattern:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;   # Docker internal DNS
set $upstream http://ordeck-shell:80;
proxy_pass $upstream;
```

This is mandatory for every new location block. A down service returns 502 on its vhost;
it does not crash nginx.

### git checkout on TrueNAS — mode-bit flips, `git config` fails

POSIX_RESTRICTED ACLs cause constant mode-bit churn on checkout. `git config` itself
can't write because `.git/config.lock` chmod fails. Use:

```bash
git -c core.fileMode=false reset --hard origin/<branch>
```

Never run `git config core.fileMode false` — it hangs on the lock.

### nginx config is a FILE bind-mount — `reset --hard` needs a restart, not reload

`standalone-nginx` runs from the **staging checkout** and mounts
`infra/nginx/standalone.conf` as a single-file bind mount
(`./standalone.conf:/etc/nginx/nginx.conf:ro`). `git reset --hard` replaces the
file's inode; the container's mount stays pinned to the **old** inode, so
`nginx -s reload` re-reads stale content and config changes silently never
apply. Fix: `docker restart standalone-nginx` (re-resolves the mount). The
jkos-deploy controller does this automatically after each `reset --hard`. When
editing `standalone.conf` by hand on the server, restart — don't reload.

Note that nginx serves **both** prod and staging and is bind-mounted from
`/mnt/Luna/Webhost/jkOS-staging/infra/nginx/standalone.conf`, so edit/sync that
checkout's copy when changing the proxy config.

### Compose refuses unlabeled pre-existing networks

If a network was created manually (or by an older compose run without labels), `docker
compose up` refuses to manage it. Diagnose with `docker network inspect <name>` — if
`Labels` is empty, remove (`docker network rm`) and let compose recreate it.

## Verification checklist (after changes)

1. `pnpm install` → `pnpm build` (or `pnpm --filter @jkos/<app> build`) green.
2. `tsc` per app green.
3. `docker compose build` (and `-f docker-compose.staging.yml build`) from root — the
   real gate that shared-package resolution works in images (run on a host with Docker).
4. Log in, change theme in one app → confirm mode + accent apply identically across all
   three frontends; reload persists (proves `PATCH /auth/profile` round-trip).
