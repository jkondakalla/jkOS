# syntax=docker/dockerfile:1.7-labs
# LazurOS State node — Node/Express Weave-integrated AI gateway. Built from the repo
# ROOT context (see apps/lazuros/docker-compose.yml) so the pnpm workspace (@jkos/*)
# resolves. Backend-only: the worker (Phase 2) runs on the compute node, the ORDECK
# widget (Phase 8) lives in the portal. (The syntax directive enables COPY --parents.)
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# io_uring off: Node/libuv io_uring throws spurious EAGAIN on copyfile under ZFS
# (TrueNAS SCALE) — broke pnpm install mid-build. Same fix as the other backends.
ENV UV_USE_IO_URING=0
RUN corepack enable
WORKDIR /repo

# ── Dependency layer ──────────────────────────────────────────────────────────
# Lockfile + every workspace manifest first (COPY --parents keeps each package.json at
# its path), install before any source, so this layer is reused from cache on
# source-only rebuilds instead of rerunning install every edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY --parents **/package.json ./
RUN pnpm install --frozen-lockfile --filter @jkos/lazuros-backend...

# ── Backend bundle ────────────────────────────────────────────────────────────
# @jkos/weave/server transitively pulls auth-middleware + auth-client + design +
# suite-manifest; pnpm deploy bundles all of them, so their SOURCE must be present
# here (else the bundle has their package.json but not src → MODULE_NOT_FOUND at boot).
COPY packages/auth-middleware packages/auth-middleware
COPY packages/weave packages/weave
COPY packages/auth-client packages/auth-client
COPY packages/design packages/design
COPY packages/suite-manifest packages/suite-manifest
COPY apps/lazuros/backend apps/lazuros/backend
RUN pnpm --filter @jkos/lazuros-backend deploy --prod /out

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
COPY --from=builder /out /app

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/lazuros.db \
    LAZUROS_DEPLOYMENT_CONFIG=/app/deployment.json
EXPOSE 8080

# Health is the bespoke host-network path (matches the nginx lazuros block +
# suite-manifest healthPath), not the suite-standard /health/<id>.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/api/lazuros/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
