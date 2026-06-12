# jkOS Auth (SSO) — Node service. Built from the REPO ROOT context so the pnpm
# workspace resolves. See root docker-compose.yml.
#
# Layer-cache strategy: copy all package manifests first so pnpm install is
# cached whenever only source files change (the common case). bcryptjs is pure
# JS — no native compilation step, no build tools needed.
FROM node:20-slim AS builder
ENV UV_USE_IO_URING=0
RUN corepack enable

WORKDIR /repo

# ── Step 1: manifest files only (cache layer) ──────────────────────────────
# pnpm needs all workspace package.json files to resolve the graph, even for
# --filter. Copy them before any source so the install layer is reused when
# only server.js / public/ change.
# .npmrc carries force-legacy-deploy=true (pnpm v10 refuses `pnpm deploy`
# without it) and the ZFS hardlink import method — both needed at build time.
# The other backend images use `COPY . .` so they already get it; this image
# copies manifests selectively for layer caching, so name it explicitly.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/jkauth/package.json          apps/jkauth/
COPY apps/beigeboard/package.json      apps/beigeboard/
COPY apps/beigeboard/backend/package.json apps/beigeboard/backend/
COPY apps/ordeck/package.json          apps/ordeck/
COPY apps/sylibos/package.json         apps/sylibos/
COPY apps/sylibos/backend/package.json apps/sylibos/backend/
COPY packages/auth-client/package.json     packages/auth-client/
COPY packages/auth-middleware/package.json packages/auth-middleware/
COPY packages/design/package.json         packages/design/
COPY packages/types/package.json          packages/types/
COPY packages/ui/package.json             packages/ui/
COPY plugins/beigeboard/package.json  plugins/beigeboard/
COPY plugins/lazuros/package.json     plugins/lazuros/
COPY plugins/plex/package.json        plugins/plex/
COPY plugins/recipe/package.json      plugins/recipe/
COPY plugins/sylibos/package.json     plugins/sylibos/

# ── Step 2: install (cached until lockfile or any package.json changes) ────
RUN pnpm install --frozen-lockfile --filter @jkos/jkauth...

# ── Step 3: copy source (busts only the deploy layer, not install) ─────────
COPY apps/jkauth/ apps/jkauth/

# Deploy: copy prod node_modules + server files to /out
RUN pnpm --filter @jkos/jkauth deploy --prod /out

FROM node:20-slim
WORKDIR /app
COPY --from=builder /out /app
RUN mkdir -p /data

ENV NODE_ENV=production
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3100/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
