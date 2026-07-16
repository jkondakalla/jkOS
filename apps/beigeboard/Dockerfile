# syntax=docker/dockerfile:1.7-labs
# BeigeBoard — Vite SPA + Node backend in one image. Built from the REPO ROOT
# context (see root docker-compose.yml) so the pnpm workspace (@jkos/*) resolves.
# (The syntax directive above enables `COPY --parents` for the manifest layer.)
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# io_uring off: Node/libuv io_uring throws spurious EAGAIN on copyfile under
# ZFS (TrueNAS SCALE) — broke pnpm install mid-build with ERR_PNPM_EAGAIN.
ENV UV_USE_IO_URING=0
RUN corepack enable
WORKDIR /repo

ARG VITE_JKOS_AUTH_URL=https://auth.jkos.net
ARG VITE_BASE=/
ARG VITE_API_URL=
ENV VITE_JKOS_AUTH_URL=$VITE_JKOS_AUTH_URL \
    VITE_BASE=$VITE_BASE \
    VITE_API_URL=$VITE_API_URL

# ── Dependency layer ──────────────────────────────────────────────────────────
# Copy the lockfile + every workspace manifest first (COPY --parents keeps each
# package.json at its path) and install before any source, so the install layer
# is reused from cache on source-only rebuilds instead of rerunning every edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY --parents **/package.json ./
RUN pnpm install --frozen-lockfile --filter @jkos/beigeboard... --filter @jkos/beigeboard-backend...

# ── Backend bundle (isolated so it caches) ────────────────────────────────────
# `pnpm deploy` spends ~390s materializing the 116 MB googleapis tree into /out
# on ZFS — and that cost is the same for legacy-copy and modern-hardlink deploy
# (it's the 40k-file write that's slow, not the import method). Its only inputs
# are the backend + its workspace dep (@jkos/auth-middleware, raw JS) source, so
# running it BEFORE the frontend source keeps it cached across the common case of
# frontend/design edits — a UI rebuild is then ~15s instead of ~7min.
# The backend now deps @jkos/weave/server, which transitively pulls @jkos/auth-client
# + @jkos/design; pnpm deploy bundles all of them, so their source must be here too
# (else the bundle has @jkos/weave/package.json but not src/server → MODULE_NOT_FOUND).
# @jkos/suite-manifest is required directly by discovery.js AND transitively by
# @jkos/weave — without its source here the bundle has the manifest but not apps.js
# (Cannot find module '@jkos/suite-manifest/apps.js' → bb-app crash-loops at boot).
COPY packages/auth-middleware packages/auth-middleware
COPY packages/weave packages/weave
COPY packages/auth-client packages/auth-client
COPY packages/design packages/design
COPY packages/suite-manifest packages/suite-manifest
COPY apps/beigeboard/backend apps/beigeboard/backend
RUN pnpm --filter @jkos/beigeboard-backend deploy --prod /out

# ── Frontend source + build last (a UI edit busts only this ~9s step) ─────────
COPY . .
# Re-sync after source is present: with inject-workspace-packages, pnpm hardlinks
# COPIES of workspace deps into the store at install time. The dependency layer
# above ran with only manifests present, so any INJECTED package (e.g. @jkos/cards,
# which pnpm injects because it pulls @jkos/weave's consumer-specific subtree) was
# frozen with just its package.json and no src/ → tsc fails TS2307 'Cannot find
# module @jkos/cards'. This re-install re-injects them now that src/ exists; the
# store is warm so it only re-hardlinks (seconds). Symlinked deps (ui/design) were
# never affected. (Same propagate-on-install step the local-dev workflow uses.)
RUN pnpm install --frozen-lockfile --filter @jkos/beigeboard...
RUN pnpm --filter @jkos/beigeboard build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /out /app
COPY --from=builder /repo/apps/beigeboard/dist /app/dist

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/beigeBoard.db \
    STATIC_DIR=/app/dist
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
