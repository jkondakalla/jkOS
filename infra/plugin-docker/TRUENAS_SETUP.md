# ORDECK · TrueNAS SCALE Deployment Guide

> **⚠️ DEPRECATED (2026-06-04):** `ordeck-net` and the standalone ORDECK nginx are gone. ORDECK now uses `jkos-internal` and is served by `standalone-nginx`. See `ORDECK/docs/ORDECK.md` and `infra/docs/DEPLOYMENT.md`.

**Platform:** TrueNAS SCALE 25.04+
**Last updated:** 2026-05-28
**Status:** Auth migrated to jkOS Auth (RS256). `services/auth-api/` is deprecated — do not deploy.

---

## Overview

ORDECK runs as a set of Docker containers on TrueNAS SCALE. All containers share a single
bridge network (`ordeck-net`) except LazurOS, which runs on the host network (required for
Wake-on-LAN UDP broadcasts).

**Authentication:** Handled by **jkOS Auth** at `https://auth.jkos.net`. The browser calls it
directly with `credentials: 'include'`. The `jkos_token` cookie is `Domain=.jkos.net`, so it
reaches `jkos.net` (ORDECK) automatically. **Do not deploy `services/auth-api/`.**

**Public entry point:** nginx on ports 80/443
**Internal services:** Each service runs in its own container on `ordeck-net`
**LazurOS:** Host network only, reached by nginx via `host.docker.internal:8080`

---

## Step 0 — Prerequisites

1. TrueNAS SCALE 25.04+ with Docker Compose available
2. `git` installed on the TrueNAS shell
3. A domain pointing at your TrueNAS public IP (ORDECK deploys at the apex: `jkos.net`)
4. SSL certificate for your domain (see Step 2)
5. jkOS Auth already deployed at `auth.jkos.net` (see `TRUENAS_SETUP.md` in the Hub root)

---

## Step 1 — Clone Repositories

```bash
mkdir -p /mnt/Luna/Webhost/jkOS && cd /mnt/Luna/Webhost/jkOS

git clone https://github.com/jkondakalla/ORDECK.git
git clone https://github.com/jkondakalla/BeigeBoard.git
git clone https://github.com/jkondakalla/LazurOS.git
git clone https://github.com/jkondakalla/SylibOS.git
```

> `BeigeBoard/`, `LazurOS/`, and `SylibOS/` must be siblings of `ORDECK/`.

---

## Step 2 — SSL Certificate

Place certificate files at the paths in `docker/nginx/docker-compose.yml`:

```
/mnt/Luna/Backends/ssl/jkos.net.crt
/mnt/Luna/Backends/ssl/jkos.net.key
```

**Option A — TrueNAS ACME (Let's Encrypt):**
1. TrueNAS UI → System → Certificates → Add → ACME Certificate
2. Export and copy `.crt` and `.key` to the paths above

**Option B — Self-signed (local/dev only):**
```bash
openssl req -x509 -newkey rsa:4096 -keyout /mnt/Luna/Backends/ssl/jkos.net.key \
  -out /mnt/Luna/Backends/ssl/jkos.net.crt -days 365 -nodes \
  -subj "/CN=jkos.net"
```

---

## Step 3 — Google OAuth2 Setup (BeigeBoard Calendar only)

ORDECK login uses jkOS Auth — no Google OAuth setup needed here for user auth.

BeigeBoard Calendar sync still needs a Google OAuth app:
1. [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID → Web application
3. Add Authorized redirect URI: `https://jkos.net/api/beigeboard/api/auth/google/callback`
4. Copy Client ID and Secret → paste into BeigeBoard `.env` (Step 7b)

---

## Step 4 — LazurOS Bearer Token

LazurOS validates a static bearer token — not a JWT. Generate one:

```bash
openssl rand -hex 32
```

Paste this into `LAZUROS_TOKEN` in LazurOS, BeigeBoard, and SylibOS `.env` files.
All three must use the **same value**.

---

## Step 5 — Get the jkOS Auth Public Key

All backend services validate `jkos_token` cookies using the RSA public key from jkOS Auth:

```bash
cat /mnt/Luna/Webhost/jkOS/jkos-auth/.env | grep JKOS_AUTH_PUBLIC_KEY
```

Copy the full value (everything after `JKOS_AUTH_PUBLIC_KEY=`). Paste it into every service
`.env` as `JKOS_AUTH_PUBLIC_KEY=`.

---

## Step 6 — Create Docker Network

```bash
docker network create ordeck-net
```

---

## Step 7 — Fill in .env Files

### 7a — LazurOS

| Variable | Value |
|----------|-------|
| `LAZUROS_TOKEN` | (from Step 4) |
| `SHELL_URL` | `https://jkos.net` |
| `COMPUTE_NODE_IP` | IP of your Linux desktop, e.g. `192.168.1.50` |
| `COMPUTE_NODE_MAC` | MAC of the desktop NIC, e.g. `AA:BB:CC:DD:EE:FF` |
| `COMPUTE_API_PORT` | `11434` |
| `LAZUROS_LISTEN_PORT` | `8080` |
| `WAKE_TIMEOUT_SECONDS` | `45` |

---

### 7b — BeigeBoard

In the ORDECK context, BeigeBoard's API runs at `ordeck-beigeboard-api:8003` (proxied
by ORDECK nginx at `/api/beigeboard/`).

| Variable | Value |
|----------|-------|
| `JKOS_AUTH_PUBLIC_KEY` | (from Step 5) |
| `JKOS_AUTH_URL` | `https://auth.jkos.net` |
| `SHELL_URL` | `https://jkos.net` |
| `GOOGLE_CLIENT_ID` | (from Step 3 — calendar sync only) |
| `GOOGLE_CLIENT_SECRET` | (from Step 3) |
| `GOOGLE_REDIRECT_URI` | `https://jkos.net/api/beigeboard/api/auth/google/callback` |
| `LAZUROS_URL` | `http://host.docker.internal:8080` |
| `LAZUROS_TOKEN` | (from Step 4) |
| `LAZUROS_DEFAULT_MODEL` | `llama3.2` |

---

### 7c — Plex API

| Variable | Value |
|----------|-------|
| `JKOS_AUTH_PUBLIC_KEY` | (from Step 5) |
| `SHELL_URL` | `https://jkos.net` |
| `LAZUROS_URL` | `http://host.docker.internal:8080` |
| `LAZUROS_TOKEN` | (from Step 4) |
| `LAZUROS_DEFAULT_MODEL` | `llama3.2` |

---

### 7d — Recipe API

Same variables as Plex API above.

---

### 7e — Nginx

Replace `jkos.net` with your actual domain:

```bash
sed -i 's/jkos.net/jkos.net/g' \
  /mnt/Luna/Webhost/jkOS/ORDECK/docker/nginx/nginx.conf \
  /mnt/Luna/Webhost/jkOS/ORDECK/docker/nginx/docker-compose.yml
```

---

## Step 8 — Start Services (in order)

```bash
BASE=/mnt/Luna/Webhost/jkOS/ORDECK/docker

# 1. LazurOS API (host network)
cd /mnt/Luna/Webhost/jkOS/LazurOS
docker compose up -d

# 2. BeigeBoard (plugin + API)
cd $BASE/beigeboard
docker compose up -d

# 3. Plex (plugin + API)
cd $BASE/plex
docker compose up -d

# 4. Recipe (plugin + API)
cd $BASE/recipe
docker compose up -d

# 5. LazurOS plugin
cd $BASE/lazuros
docker compose up -d lazuros-plugin

# 6. Shell
cd $BASE/shell
docker compose up -d

# 7. Nginx (last)
cd $BASE/nginx
docker compose up -d
```

> **Do not start `services/auth-api/`.** Auth is handled by jkOS Auth at `auth.jkos.net`.

---

## Step 9 — Verify

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Expected containers:
#   ordeck-nginx
#   ordeck-shell
#   ordeck-plex-api
#   ordeck-plex-plugin
#   ordeck-recipe-api
#   ordeck-recipe-plugin
#   ordeck-beigeboard-api
#   ordeck-beigeboard-plugin
#   lazuros              (host network)
#   ordeck-lazuros-plugin

# Test LazurOS:
curl http://localhost:8080/health

# Test via nginx:
curl -k https://jkos.net/api/lazuros/health
curl -k https://jkos.net/ -I   # shell: 200 OK
```

---

## Step 10 — Port Forwarding

| External Port | Internal | Protocol |
|--------------|----------|----------|
| 443 | YOUR_TRUENAS_IP:443 | TCP |
| 80 | YOUR_TRUENAS_IP:80 | TCP |

---

## Network Architecture

```
Browser (jkos.net)
       │
       │ HTTPS :443
       ▼
┌──────────────────────────────────────────────────────┐
│  TrueNAS SCALE host                                   │
│                                                        │
│  ┌─── ordeck-net ───────────────────────────────┐    │
│  │                                               │    │
│  │  ordeck-nginx :80/:443                        │    │
│  │    ├─ /api/plex/       → ordeck-plex-api      │    │
│  │    ├─ /api/recipes/    → ordeck-recipe-api    │    │
│  │    ├─ /api/beigeboard/ → ordeck-beigeboard-api│    │
│  │    ├─ /api/lazuros/    → host.docker.internal │    │
│  │    ├─ /plugins/*/      → ordeck-*-plugin      │    │
│  │    └─ /                → ordeck-shell         │    │
│  │                                               │    │
│  │  Auth: browser calls auth.jkos.net directly   │    │
│  │  (jkos_token cookie Domain=.jkos.net)         │    │
│  │                                               │    │
│  └───────────────────────────────────────────────┘    │
│                                                        │
│  ┌─── Host network ─────────────────────────────┐    │
│  │  lazuros :8080 (WoL + Ollama proxy)           │    │
│  └───────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                    │
              Linux desktop :11434 (Ollama)

SSO: auth.jkos.net issues jkos_token (RS256 JWT, Domain=.jkos.net)
     Each service validates locally with JKOS_AUTH_PUBLIC_KEY — no round-trip
```

---

## Troubleshooting

### Auth failing (401 on API calls)
- Confirm `JKOS_AUTH_PUBLIC_KEY` is set in every backend service `.env`
- Confirm the key matches `JKOS_AUTH_PUBLIC_KEY` in `jkos-auth/.env`
- Confirm `jkos_token` cookie exists in browser: DevTools → Application → Cookies
- Confirm jkOS Auth is running at `auth.jkos.net`

### LazurOS unreachable (502 on /api/lazuros/)
- `curl http://localhost:8080/health` from TrueNAS shell
- Confirm `extra_hosts: ["host.docker.internal:host-gateway"]` is in nginx docker-compose

### Wake-on-LAN not working
- Desktop NIC must have WoL enabled in BIOS and via `ethtool -s YOUR_NIC wol g`
- LazurOS must run with `network_mode: host`
- Test: `wakeonlan XX:XX:XX:XX:XX:XX` from TrueNAS shell

### Module Federation widget not loading
- Check browser console for `remoteEntry.js` errors
- Confirm plugin container is running: `docker ps | grep plugin`

---

## Updating

```bash
cd /mnt/Luna/Webhost/jkOS/ORDECK && git pull

# Rebuild a specific service:
cd docker/plex && docker compose up -d --build

# Rebuild all:
for dir in beigeboard plex recipe lazuros shell; do
  cd /mnt/Luna/Webhost/jkOS/ORDECK/docker/$dir
  docker compose up -d --build
done
cd /mnt/Luna/Webhost/jkOS/ORDECK/docker/nginx && docker compose up -d
```

---

## Environment Variable Quick Reference

| Service | Container | Key Env Vars |
|---------|-----------|--------------|
| LazurOS API | `lazuros` | `LAZUROS_TOKEN`, `SHELL_URL`, `COMPUTE_NODE_IP/MAC` |
| BeigeBoard API | `ordeck-beigeboard-api` | `JKOS_AUTH_PUBLIC_KEY`, `GOOGLE_*`, `LAZUROS_TOKEN` |
| Plex API | `ordeck-plex-api` | `JKOS_AUTH_PUBLIC_KEY`, `LAZUROS_TOKEN` |
| Recipe API | `ordeck-recipe-api` | `JKOS_AUTH_PUBLIC_KEY`, `LAZUROS_TOKEN` |
| Shell | `ordeck-shell` | `VITE_JKOS_AUTH_URL=https://auth.jkos.net`, `VITE_APP_ORIGIN=https://jkos.net` |
| Nginx | `ordeck-nginx` | (none — reads nginx.conf) |

`LAZUROS_TOKEN` must be the same value in LazurOS, BeigeBoard, SylibOS, Plex, and Recipe.
`JKOS_AUTH_PUBLIC_KEY` must be the same value in all backend services — copy from `jkos-auth/.env`.
