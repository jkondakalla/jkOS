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
ARG VITE_BB_AI_ENABLED=false
ENV VITE_JKOS_AUTH_URL=$VITE_JKOS_AUTH_URL \
    VITE_BASE=$VITE_BASE \
    VITE_API_URL=$VITE_API_URL \
    VITE_BB_AI_ENABLED=$VITE_BB_AI_ENABLED

# ── Dependency layer ──────────────────────────────────────────────────────────
# Copy the lockfile + every workspace manifest first (COPY --parents keeps each
# package.json at its path) and install before any source, so the install layer
# is reused from cache on source-only rebuilds instead of rerunning every edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY --parents **/package.json ./
RUN pnpm install --frozen-lockfile --filter @jkos/beigeboard... --filter @jkos/beigeboard-backend...

# ── Source + build + deploy ───────────────────────────────────────────────────
COPY . .
RUN pnpm --filter @jkos/beigeboard build
# Bundle the backend with its workspace deps (incl. @jkos/auth-middleware). With
# inject-workspace-packages in .npmrc this is the modern hardlink `pnpm deploy`
# (seconds), not the old ~390s legacy copy of the googleapis tree.
RUN pnpm --filter @jkos/beigeboard-backend deploy --prod /out

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
