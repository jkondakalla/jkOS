# syntax=docker/dockerfile:1.7-labs
# KourOS — Vite SPA + Node backend in one image. Built from the REPO ROOT context
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
RUN pnpm install --frozen-lockfile --filter @jkos/kouros... --filter @jkos/kouros-backend...

# ── Backend bundle (isolated so it caches across frontend edits) ──────────────
# `pnpm deploy` materializes the backend + its workspace deps into /out. Its deps are
# @jkos/weave/server (which transitively pulls @jkos/auth-client + @jkos/design) and
# @jkos/suite-manifest (required by discovery.js AND transitively by @jkos/weave) and
# @jkos/files (a dep of @jkos/weave — its server/mediaRoutes.js requires it at module
# load) — all their source must be present or the bundle has the package.json but not
# the source (MODULE_NOT_FOUND at boot). Running deploy BEFORE the frontend keeps cache.
COPY packages/auth-middleware packages/auth-middleware
COPY packages/weave packages/weave
COPY packages/files packages/files
COPY packages/auth-client packages/auth-client
COPY packages/design packages/design
COPY packages/suite-manifest packages/suite-manifest
COPY apps/kouros/backend apps/kouros/backend
RUN pnpm --filter @jkos/kouros-backend deploy --prod /out

# ── Frontend source + build last (a UI edit busts only this step) ─────────────
COPY . .
# Re-sync after source is present: with inject-workspace-packages (.npmrc), pnpm
# hardlinks COPIES (not symlinks) of any workspace dep that declares peerDependencies
# — e.g. @jkos/weave or @jkos/cards (both peer on react). The dependency layer above
# ran with only manifests present, so an injected dep is frozen with just its
# package.json and no src/, and `tsc -b` then fails TS2307 'Cannot find module …'.
# This re-install re-injects from the now-present source (store is warm → seconds);
# plain symlinked deps (ui/design/auth-client) are unaffected. Keep this step even if
# the app starts with no injected dep — the moment it adds @jkos/weave the build needs
# it. `pnpm check:docker` (in pnpm test:contracts) fails red if it's missing.
RUN pnpm install --frozen-lockfile --filter @jkos/kouros...
RUN pnpm --filter @jkos/kouros build

FROM node:20-slim
# ffmpeg: the library scanner probes EVERY audio file under MUSIC_DIR with ffprobe at
# runtime (src/library/scan.js → @jkos/weave/libraryScanner). Without it the scan does
# not merely degrade — it spins a core forever: each probe fails `spawn ffprobe ENOENT`
# instantly, buildUnitRow returns null so no row is ever written, and the brick's
# mtime-incremental skip only fires for a unit that ALREADY has a row — so all ~15k
# files are re-probed and re-fail on every single boot, starving the event loop until
# /health times out and the container sits `unhealthy` (staging, 2026-08-25).
# This stage was mirrored from apps/beigeboard/Dockerfile, which has no media and so
# never carried this line; apps/papyros/Dockerfile — the app that actually shares the
# scanner brick — is the correct reference and has always installed it.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /out /app
COPY --from=builder /repo/apps/kouros/dist /app/dist

ENV NODE_ENV=production \
    PORT=3011 \
    DB_PATH=/data/kouros.db \
    STATIC_DIR=/app/dist
EXPOSE 3011

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3011/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
