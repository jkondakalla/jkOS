# ORDECK shell — static SPA. Built from the REPO ROOT context so the pnpm
# workspace (packages/@jkos/*) is available. See root docker-compose.yml.
FROM node:20-alpine AS builder
# io_uring off: Node/libuv io_uring throws spurious EAGAIN on copyfile under
# ZFS (TrueNAS SCALE) — broke pnpm install mid-build with ERR_PNPM_EAGAIN.
ENV UV_USE_IO_URING=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @jkos/ordeck...
RUN pnpm --filter @jkos/ordeck build

FROM nginx:alpine
COPY --from=builder /repo/apps/ordeck/dist /usr/share/nginx/html
COPY apps/ordeck/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
