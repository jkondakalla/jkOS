# SylibOS frontend — Vite SPA served by nginx. Built from the REPO ROOT context
# so the pnpm workspace (@jkos/*) resolves. See root docker-compose.yml.
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo

ARG VITE_JKOS_AUTH_URL=https://auth.jkos.net
ARG VITE_BASE=/
ENV VITE_JKOS_AUTH_URL=$VITE_JKOS_AUTH_URL VITE_BASE=$VITE_BASE

COPY . .
RUN pnpm install --frozen-lockfile --filter @jkos/sylibos...
RUN pnpm --filter @jkos/sylibos build

FROM nginx:alpine
COPY --from=builder /repo/apps/sylibos/dist /usr/share/nginx/html
# SPA fallback: serve index.html for all routes
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
