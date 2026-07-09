# syntax=docker/dockerfile:1.7-labs
# PapyrOS — Vite SPA + Node backend in one image. Built from the REPO ROOT context
# (see root docker-compose.yml) so the pnpm workspace (@jkos/*) resolves. Mirrors the
# reference app's Dockerfile (apps/beigeboard/Dockerfile); the COPY --parents directive
# above enables the manifest-only dependency layer.
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# io_uring off: Node/libuv io_uring throws spurious EAGAIN on copyfile under ZFS
# (TrueNAS SCALE) — it broke pnpm install mid-build with ERR_PNPM_EAGAIN.
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
# package.json at its path) and install before any source, so the install layer is
# reused from cache on source-only rebuilds.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY --parents **/package.json ./
RUN pnpm install --frozen-lockfile --filter @jkos/papyros... --filter @jkos/papyros-backend...

# ── Backend bundle (isolated so it caches across frontend edits) ──────────────
# `pnpm deploy` materializes the backend + its workspace deps into /out. Its deps are
# @jkos/weave/server (which transitively pulls @jkos/auth-client + @jkos/design) and
# @jkos/suite-manifest (required by discovery.js AND transitively by @jkos/weave) — all
# their source must be present or the bundle has the package.json but not the source
# (MODULE_NOT_FOUND at boot). Running deploy BEFORE the frontend source keeps it cached.
COPY packages/auth-middleware packages/auth-middleware
COPY packages/weave packages/weave
COPY packages/auth-client packages/auth-client
COPY packages/design packages/design
COPY packages/suite-manifest packages/suite-manifest
COPY apps/papyros/backend apps/papyros/backend
RUN pnpm --filter @jkos/papyros-backend deploy --prod /out

# ── Frontend source + build last (a UI edit busts only this step) ─────────────
COPY . .
# Re-sync after source is present: with inject-workspace-packages (.npmrc), pnpm
# hardlinks COPIES (not symlinks) of any workspace dep that declares peerDependencies
# into the store at install time — here @jkos/weave (it peers on react, so it's
# injected). The dependency layer above ran with only manifests present, so that
# injected copy was frozen with just its package.json and no src/, and `tsc -b` then
# fails TS2307 'Cannot find module @jkos/weave'. This re-install re-injects from the
# now-present source (store is warm → seconds). Plain symlinked deps (ui/design/
# auth-client) were never affected. Keep this step — `pnpm check:docker` fails red if
# a frontend build follows `COPY . .` without it. (Mirrors apps/beigeboard/Dockerfile.)
RUN pnpm install --frozen-lockfile --filter @jkos/papyros...
RUN pnpm --filter @jkos/papyros build

FROM node:20-slim
# ffmpeg: audiobook transcoding/probing at runtime (not needed at build time).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /out /app
COPY --from=builder /repo/apps/papyros/dist /app/dist

ENV NODE_ENV=production \
    PORT=3010 \
    DB_PATH=/data/papyros.db \
    STATIC_DIR=/app/dist
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3010/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
