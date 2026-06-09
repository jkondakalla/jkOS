# ORDECK shell — static SPA. Built from the REPO ROOT context so the pnpm
# workspace (packages/@jkos/*) is available. See root docker-compose.yml.
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @jkos/ordeck...
RUN pnpm --filter @jkos/ordeck build

FROM nginx:alpine
COPY --from=builder /repo/apps/ordeck/dist /usr/share/nginx/html
COPY apps/ordeck/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
