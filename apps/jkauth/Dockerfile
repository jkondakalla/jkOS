# jkOS Auth (SSO) — Node service. Built from the REPO ROOT context so the pnpm
# workspace resolves. See root docker-compose.yml.
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @jkos/jkauth...
# Bundle server.js + public/ + prod node_modules (bcrypt, better-sqlite3, …)
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
