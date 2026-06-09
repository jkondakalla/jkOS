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
| Prod data volumes | `/mnt/Luna/Backends/<svc>-data` |
| Staging data volumes | `/mnt/Luna/Backends-Staging/<svc>-data` |
| nginx SSL (CF origin cert) | `/mnt/Luna/Backends/ssl` |

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

## Verification checklist (after changes)

1. `pnpm install` → `pnpm build` (or `pnpm --filter @jkos/<app> build`) green.
2. `tsc` per app green.
3. `docker compose build` (and `-f docker-compose.staging.yml build`) from root — the
   real gate that shared-package resolution works in images (run on a host with Docker).
4. Log in, change theme in one app → confirm mode + accent apply identically across all
   three frontends; reload persists (proves `PATCH /auth/profile` round-trip).
