# SylibOS API — Node ESM service. Built from the REPO ROOT context so the pnpm
# workspace (@jkos/auth-middleware) resolves. See root docker-compose.yml.
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @jkos/sylibos-api...
# Bundle the API with its workspace deps (incl. @jkos/auth-middleware)
RUN pnpm --filter @jkos/sylibos-api deploy --prod /out

FROM node:20-slim
WORKDIR /app
COPY --from=builder /out /app

ENV NODE_ENV=production
EXPOSE 8004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8004/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
