# jkOS — Cold Start Guide

Complete instructions for bringing up the full stack from zero: no containers running,
no networks, fresh clone. Follow in order.

---

## Phase 0 — Prerequisites (one-time, server setup)

### 0.1 DNS

In Cloudflare (or your DNS provider), create A records pointing to your server's public IP:

| Record | Target |
|--------|--------|
| `jkos.net` (apex) | server IP |
| `auth.jkos.net` | server IP |
| `beigeboard.jkos.net` | server IP |
| `sylibos.jkos.net` | server IP |
| `staging.jkos.net` | server IP |

If using Cloudflare proxying, set all records to **DNS only** (orange → grey cloud) for
origin-cert TLS to work, or configure an origin cert with Full (Strict) mode.

### 0.2 SSL certificate

nginx expects a flat cert + key at `/mnt/Luna/Backends/ssl/`:

```bash
mkdir -p /mnt/Luna/Backends/ssl
# Place your certificate files:
#   cert.pem  — full chain (cert + intermediate)
#   key.pem   — private key
cp your-cert.pem /mnt/Luna/Backends/ssl/cert.pem
cp your-key.pem  /mnt/Luna/Backends/ssl/key.pem
chmod 644 /mnt/Luna/Backends/ssl/cert.pem
chmod 600 /mnt/Luna/Backends/ssl/key.pem
```

For a Cloudflare origin certificate: generate one in Cloudflare Dashboard →
SSL/TLS → Origin Server (wildcard `*.jkos.net` + apex `jkos.net`, 15-year). The
Cloudflare root CA cert is pre-trusted by the nginx image so no extra config needed.

### 0.3 Data directories

Create the volume mount points on TrueNAS (or whatever host):

```bash
# Production
mkdir -p /mnt/Luna/Backends/Production/jkos-auth-data
mkdir -p /mnt/Luna/Backends/Production/beigeboard-data
mkdir -p /mnt/Luna/Backends/Production/sylibos-data
mkdir -p /mnt/Luna/Backends/Production/nginx-logs

# Staging
mkdir -p /mnt/Luna/Backends/Staging/jkos-auth-data
mkdir -p /mnt/Luna/Backends/Staging/beigeboard-data
mkdir -p /mnt/Luna/Backends/Staging/sylibos-data
```

### 0.4 Generate the RS256 keypair

jkAuth mints JWTs with the private key; every other backend verifies with the public key.
Generate once and share the public key across all services.

```bash
# Generate the keypair
openssl genrsa -out jkos_private.pem 2048
openssl rsa -in jkos_private.pem -pubout -out jkos_public.pem

# Inline newlines as \n (required for .env single-line format)
PRIVATE_KEY=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jkos_private.pem)
PUBLIC_KEY=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jkos_public.pem)

echo "JKOS_AUTH_PRIVATE_KEY=$PRIVATE_KEY"
echo "JKOS_AUTH_PUBLIC_KEY=$PUBLIC_KEY"
```

Keep both printed values — you'll need them in Phase 2. The private key goes in jkAuth
only; the public key goes in every other backend service.

---

## Phase 1 — Clone the repo

SSH to the server:

```bash
ssh truenas_admin@192.168.1.108
```

Clone for production and staging (two separate checkouts):

```bash
git clone https://github.com/jkondakalla/jkOS.git /mnt/Luna/Webhost/jkOS
git clone https://github.com/jkondakalla/jkOS.git /mnt/Luna/Webhost/jkOS-staging
cd /mnt/Luna/Webhost/jkOS-staging && git checkout staging
```

> **TrueNAS note:** ZFS ACLs cause mode-bit flips. If `git config` fails with a
> lock error, use `git -c core.fileMode=false reset --hard origin/<branch>` instead
> of the standard `git reset`.

---

## Phase 2 — Create .env files

Do this for **both** checkouts. The staging checkout uses the same `.env` files (staging
containers inherit `.env` from each `apps/<svc>/` directory; the staging-specific
overrides like issuer and cookie domain are baked into `docker-compose.staging.yml`).

### 2.1 jkAuth — `apps/jkauth/.env`

```bash
cd /mnt/Luna/Webhost/jkOS
cp apps/jkauth/.env.example apps/jkauth/.env
```

Required values (edit the file):

```ini
JKOS_AUTH_PRIVATE_KEY=<from Phase 0.4>
JKOS_AUTH_PUBLIC_KEY=<from Phase 0.4>

COOKIE_DOMAIN=.jkos.net
AUTH_ORIGIN=https://auth.jkos.net
PORTAL_URL=https://jkos.net

# Google OAuth — create app at console.cloud.google.com
# Authorized redirect URI: https://auth.jkos.net/auth/google/callback
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=https://auth.jkos.net/auth/google/callback

# Optional: auto-creates an admin user on first boot
ADMIN_SEED_EMAIL=you@example.com
ADMIN_SEED_PASSWORD=<strong-password>
```

### 2.2 BeigeBoard — `apps/beigeboard/.env`

```bash
cp apps/beigeboard/.env.example apps/beigeboard/.env
```

Required values:

```ini
JKOS_AUTH_PUBLIC_KEY=<same public key from Phase 0.4>
JKOS_AUTH_URL=https://auth.jkos.net
VITE_JKOS_AUTH_URL=https://auth.jkos.net
SHELL_URL=https://beigeboard.jkos.net

# Google Calendar OAuth
# Authorized redirect URI: https://beigeboard.jkos.net/api/auth/google/callback
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=https://beigeboard.jkos.net/api/auth/google/callback

# LazurOS (optional — for NL task parsing)
LAZUROS_URL=http://host.docker.internal:8080
LAZUROS_TOKEN=<choose-a-random-secret-token>
```

### 2.3 SylibOS — `apps/sylibos/backend/.env`

> The frontend SPA has no runtime env vars; use `apps/sylibos/backend/.env`.

```bash
cp apps/sylibos/backend/.env.example apps/sylibos/backend/.env
# Also create the frontend .env (only needed for local dev, but keep it in sync)
cp apps/sylibos/.env.example apps/sylibos/.env
```

Required values in `apps/sylibos/backend/.env`:

```ini
JKOS_AUTH_PUBLIC_KEY=<same public key from Phase 0.4>
JKOS_AUTH_URL=https://auth.jkos.net
VITE_JKOS_AUTH_URL=https://auth.jkos.net
SHELL_URL=https://sylibos.jkos.net

# AI provider for nightly quiz generation
# Options: lazuros | ollama | none
AI_PROVIDER=lazuros
LAZUROS_URL=http://host.docker.internal:8080
LAZUROS_TOKEN=<same token as BeigeBoard's LAZUROS_TOKEN>
```

### 2.4 LazurOS — `apps/lazuros/.env`

```bash
cp apps/lazuros/.env.example apps/lazuros/.env
```

Required values:

```ini
LAZUROS_TOKEN=<same token as BeigeBoard/SylibOS>
JKOS_AUTH_PUBLIC_KEY=<same public key from Phase 0.4>
JKOS_AUTH_ISSUER=jkos-auth

# The Linux desktop running Ollama
COMPUTE_NODE_IP=192.168.X.XXX   # desktop's LAN IP
COMPUTE_NODE_MAC=XX:XX:XX:XX:XX:XX  # desktop's MAC (for Wake-on-LAN)
COMPUTE_API_PORT=11434

AUTO_WAKE=true
WAKE_TIMEOUT_SECONDS=45
GENERATION_TIMEOUT_SECONDS=600
```

### 2.5 ORDECK — `apps/ordeck/.env`

```bash
cp apps/ordeck/.env.example apps/ordeck/.env
```

Required values:

```ini
VITE_JKOS_AUTH_URL=https://auth.jkos.net
VITE_APP_ORIGIN=https://jkos.net
JKOS_AUTH_PUBLIC_KEY=<same public key from Phase 0.4>
SHELL_URL=https://jkos.net
LAZUROS_URL=http://host.docker.internal:8080
LAZUROS_TOKEN=<same token>
```

### 2.6 Copy .env files to staging checkout

The staging checkout reads the same `.env` files; staging-specific overrides (issuer,
cookie domain, URL) come from `docker-compose.staging.yml` at runtime.

```bash
for app in jkauth beigeboard lazuros ordeck; do
    cp /mnt/Luna/Webhost/jkOS/apps/$app/.env \
       /mnt/Luna/Webhost/jkOS-staging/apps/$app/.env
done
cp /mnt/Luna/Webhost/jkOS/apps/sylibos/backend/.env \
   /mnt/Luna/Webhost/jkOS-staging/apps/sylibos/backend/.env
```

---

## Phase 3 — Start nginx (creates Docker networks)

nginx must start first because it creates the `jkos-internal` and `nginx-staging-proxy`
Docker networks. All other services join these as external networks.

```bash
cd /mnt/Luna/Webhost/jkOS/infra/nginx
docker compose up -d
```

Verify:

```bash
docker ps --filter name=standalone-nginx
docker network ls | grep -E "jkos-internal|nginx-staging-proxy"
```

Both networks must appear before proceeding.

---

## Phase 4 — Start production services

From the repo root, build and start everything in one command. The root `docker-compose.yml`
uses `include:` to pull in all five service compose files.

```bash
cd /mnt/Luna/Webhost/jkOS
docker compose up -d --build
```

This builds and starts: `lazuros`, `jkos-auth`, `bb-app`, `sylibos-frontend`,
`sylibos-api`, `ordeck-shell`.

> **First build takes 5–15 minutes** (pnpm installs the full workspace inside Docker).
> Subsequent builds are fast (layer cache). If you see `ERR_PNPM_EAGAIN`, check that
> the root `.npmrc` contains `package-import-method=hardlink` — this is the ZFS fix.

Check containers are up:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected state:

| Container | Status |
|-----------|--------|
| `standalone-nginx` | Up |
| `jkos-auth` | Up (healthy) |
| `bb-app` | Up (healthy) |
| `sylibos-api` | Up (healthy) |
| `sylibos-frontend` | Up |
| `ordeck-shell` | Up |
| `lazuros` | Up |

---

## Phase 5 — Verify production

```bash
# jkOS portal (ORDECK) — expect 200 or redirect
curl -sk https://jkos.net/ -o /dev/null -w "%{http_code}\n"

# jkAuth health
curl -sk https://auth.jkos.net/health

# BeigeBoard — expect 200
curl -sk https://beigeboard.jkos.net/ -o /dev/null -w "%{http_code}\n"

# SylibOS — expect 200
curl -sk https://sylibos.jkos.net/ -o /dev/null -w "%{http_code}\n"

# LazurOS health (direct, not through nginx — it's on the host network)
curl -s http://localhost:8080/health
```

If a container is unhealthy, check its logs:

```bash
docker logs jkos-auth --tail 50
docker logs sylibos-api --tail 50
```

---

## Phase 6 — Start staging services (optional)

Staging is path-routed under `staging.jkos.net` via the `nginx-staging-proxy` network
that nginx created in Phase 3. The staging checkout uses `docker-compose.staging.yml`.

```bash
cd /mnt/Luna/Webhost/jkOS-staging
docker compose -f docker-compose.staging.yml up -d --build
```

This starts: `staging-jkos-auth`, `staging-bb-app`, `staging-sylibos-frontend`,
`staging-sylibos-api`.

Verify the staging gate (returns 302 → jkAuth login for non-admins):

```bash
curl -sk https://staging.jkos.net/ -o /dev/null -w "%{http_code}\n"
```

> **Admin gate:** every staging route is gated by `auth_request` →
> `jkos-auth /auth/require-admin` (prod auth). Staging will return 502 on gated routes
> until the prod `jkos-auth` container is healthy. Start prod first.

---

## Startup order summary

```
1.  infra/nginx               → docker compose up -d
                                  (creates jkos-internal + nginx-staging-proxy)
2.  <repo root> (prod)        → docker compose up -d --build
3.  <repo root> (staging)     → docker compose -f docker-compose.staging.yml up -d --build
```

nginx must always be first. Prod must be running before staging (for the admin gate).
Within prod, there are no hard ordering constraints — lazuros starts independently.

---

## Re-deploy (after code changes)

### Production

```bash
cd /mnt/Luna/Webhost/jkOS
git -c core.fileMode=false fetch origin
git -c core.fileMode=false reset --hard origin/main
docker compose up -d --build
```

### Staging

```bash
cd /mnt/Luna/Webhost/jkOS-staging
git -c core.fileMode=false fetch origin
git -c core.fileMode=false reset --hard origin/staging
docker compose -f docker-compose.staging.yml up -d --build
```

---

## Troubleshooting

### nginx won't start — "host not found in upstream"
All `proxy_pass` directives in `standalone.conf` use the `set $upstream` lazy pattern.
If you see this error, a production service block has a literal `proxy_pass` hostname —
it must be converted to the `set $upstream` form. See `infra/nginx/standalone.conf` for
the pattern and OPERATIONS.md for the reason.

### pnpm build fails with `ERR_PNPM_EAGAIN` inside Docker
This is a TrueNAS ZFS + overlay filesystem issue. Verify `root/.npmrc` contains:
```ini
package-import-method=hardlink
```
If it does and builds still fail, check that Docker's storage driver is `overlay2` and
that `UV_USE_IO_URING=0` is set in the Dockerfile (already set in all JS Dockerfiles).

### Container starts but auth fails (401/403 loops)
The `JKOS_AUTH_PUBLIC_KEY` in the failing service's `.env` must exactly match the
public key that `jkos-auth` is using (same keypair). Rebuild after updating `.env` —
Vite bakes `VITE_*` vars at build time; backend vars are read at startup.

### Staging admin gate returns 502
The gate's `auth_request` targets prod `jkos-auth:3100`. Start prod first (Phase 4).

### `git config` fails with lock permission error
TrueNAS POSIX_RESTRICTED ACLs prevent mode-bit writes. Use:
```bash
git -c core.fileMode=false reset --hard origin/<branch>
```
Never run `git config core.fileMode false` — it blocks on the lock.

### Data volume permissions
If a container exits immediately with permission errors on `/data`, ensure the data
directory exists on the host and is owned by the user the container runs as:
```bash
# jkAuth and BeigeBoard run as node (uid 1000 in the alpine image)
chown -R 1000:1000 /mnt/Luna/Backends/Production/jkos-auth-data
chown -R 1000:1000 /mnt/Luna/Backends/Production/beigeboard-data
# etc.
```
