#!/usr/bin/env bash
# Shared deploy routine for deploy-staging.sh / deploy-prod.sh. Sourced, never
# run directly. The jkos-deploy controller and a human on the host both go
# through the entry scripts, so this is the ONE place the deploy steps live.
#
# Required env (set by the entry script / controller):
#   ENV_NAME       label for logs               e.g. "staging" / "production"
#   REPO_DIR       checkout to deploy           (the caller's view of the path)
#   BRANCH         branch to reset to           e.g. "staging"
#   COMPOSE_FILE   compose file inside REPO_DIR  e.g. "docker-compose.yml"
# Optional:
#   HOST_REPO_DIR  REPO_DIR as seen by the HOST docker daemon (for bind mounts
#                  when this runs inside the controller container). Default REPO_DIR.
#   SSL_PATH       host path to the nginx ssl dir. Default /mnt/Luna/Backends/ssl.
#   MANAGE_NGINX   1 = this deploy owns the standalone-nginx config (validate +
#                  restart it when infra/nginx changed); 0 = leave nginx alone.
#                  standalone-nginx bind-mounts its config from ONE checkout (the
#                  staging one), so only that checkout's deploy should touch it —
#                  a prod deploy sets this 0 to avoid a spurious, unvalidated
#                  restart that blips every site behind the proxy. Default 1.
#   HOST_NGINX_DIR host path of the checkout standalone-nginx actually mounts its
#                  config from (what `nginx -t` must validate). Default HOST_REPO_DIR.
#
# Output convention — the deploy console (jkos-deploy/static/index.html)
# colorizes these, so keep them:
#   "$ ..."        command echo  (green)
#   "=== ... ==="  section head  (amber)
#   "[ERROR] ..."  failure       (red)

HOST_REPO_DIR="${HOST_REPO_DIR:-$REPO_DIR}"
SSL_PATH="${SSL_PATH:-/mnt/Luna/Backends/ssl}"
MANAGE_NGINX="${MANAGE_NGINX:-1}"
HOST_NGINX_DIR="${HOST_NGINX_DIR:-$HOST_REPO_DIR}"
# git refuses bind-mounted checkouts owned by another uid ("dubious ownership");
# safe.directory=* whitelists them. Quote the glob so the array assignment keeps
# it literal instead of expanding it against the cwd.
GIT=(git -c 'safe.directory=*')

log() { echo "$*"; }
err() { echo "[ERROR] $*"; }
die() { err "$*"; exit 1; }
# Echo then run a command; abort the whole deploy if it fails. The `if !` context
# suppresses `set -e` so we can print a useful message instead of dying silently.
run() {
  echo "\$ $*"
  "$@"
  local rc=$?
  [ $rc -eq 0 ] || die "command failed (exit $rc): $*"
}

# `env_file: .env` (any app that verifies identity or holds OAuth/API secrets) is
# gitignored by design — so a checkout freshly cloned/reset onto a NEW app (one that
# never had a human SSH in and create its .env) has no such file, and `docker compose
# up -d` refuses the ENTIRE stack with exit 14 ("env file ... not found"). Worse, that
# only surfaces AFTER the full (multi-minute) image build. Papyros's first staging
# sync hit exactly this (2026-07-09) — this makes it self-heal instead, for any
# app, present or future: scaffold a blank .env from the app's own .env.example
# (every app ships one) so a first deploy succeeds with safe defaults/no-ops, and
# log loudly so the real secrets get filled in by hand afterward.
ensure_env_files() {
  log "=== Pre-flight: checking per-app .env files ==="
  local dir base envfile example missing=0
  for dir in "$REPO_DIR"/apps/*/; do
    dir="${dir%/}"
    base=$(basename "$dir")
    ls "$dir"/docker-compose*.yml >/dev/null 2>&1 || continue
    grep -qE '^\s*-?\s*env_file:' "$dir"/docker-compose*.yml 2>/dev/null || continue
    envfile="$dir/.env"
    [ -f "$envfile" ] && continue
    example="$dir/.env.example"
    if [ -f "$example" ]; then
      cp "$example" "$envfile"
      err "created $base/.env from .env.example (blank scaffold — no real secrets set). Fill in real values on the host at $envfile, then redeploy if that app needs them."
    else
      err "$base declares env_file but the host has neither .env nor a committed .env.example to self-heal from"
      missing=1
    fi
  done
  [ "$missing" = 0 ] || die "one or more apps have no usable .env and no template to scaffold from — see above"
}

# After `up -d`, confirm the targeted containers are actually up. `compose up -d`
# returns 0 the moment containers START — a container that then crash-loops on
# boot would otherwise be reported as a successful deploy. This makes a green
# deploy mean "running", not just "started".
verify_containers() {
  log "=== Verifying containers ==="
  sleep 5  # give anything that's going to crash on boot time to do so
  local ids id state health name fail=0
  ids=$(docker compose -f "$REPO_DIR/$COMPOSE_FILE" ps -aq) || die "could not list containers"
  [ -n "$ids" ] || die "no containers found for $COMPOSE_FILE"
  for id in $ids; do
    name=$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##' || echo "$id")
    state=$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo unknown)
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$id" 2>/dev/null || echo -)
    if [ "$state" != running ]; then
      err "container $name is '$state' (expected running)"; fail=1
    elif [ "$health" = unhealthy ]; then
      err "container $name is running but health=unhealthy"; fail=1
    else
      log "  ok  $name (running, health=$health)"
    fi
  done
  [ "$fail" = 0 ] || die "one or more containers failed to come up — deploy NOT healthy"
}

# Validate the NEW nginx config in a throwaway container BEFORE the live proxy
# ever sees it. standalone-nginx fronts BOTH prod and staging, so a config that
# fails to load there is a total outage. Variable-form upstreams (resolver
# 127.0.0.11) are not resolved by `nginx -t`; the one literal upstream
# (host.docker.internal, for LazurOS) needs the host-gateway alias to resolve.
validate_nginx() {
  log "=== Validating new nginx config ==="
  # Mount standalone.conf as the main config, then EVERY file it `include`s that
  # lives in infra/nginx — derived from the config itself (same parse the reload
  # pre-flight uses) so the validator's mount list can NEVER drift from the
  # includes. A hardcoded list silently breaks the moment standalone.conf gains an
  # include the validator doesn't mount: that is exactly how a deploy that added
  # the generated apps-generated*.conf includes failed `nginx -t` ("open() ...
  # apps-generated.conf failed"). Includes the base image already provides
  # (mime.types) have no repo file and are skipped. REPO_DIR tests existence (the
  # caller's view); HOST_NGINX_DIR is the daemon's view for the bind source.
  local -a mounts=(-v "$HOST_NGINX_DIR/infra/nginx/standalone.conf:/etc/nginx/nginx.conf:ro")
  local inc base
  while IFS= read -r inc; do
    [ -n "$inc" ] || continue
    base=$(basename "$inc")
    [ -f "$REPO_DIR/infra/nginx/$base" ] || continue   # not a repo file (e.g. mime.types) — skip
    mounts+=(-v "$HOST_NGINX_DIR/infra/nginx/$base:$inc:ro")
  done < <(grep -oE '^[[:space:]]*include[[:space:]]+/etc/nginx/[^;[:space:]]+' "$REPO_DIR/infra/nginx/standalone.conf" 2>/dev/null | awk '{print $2}' | sort -u)
  run docker run --rm \
    --add-host host.docker.internal:host-gateway \
    "${mounts[@]}" \
    -v "$SSL_PATH:/etc/nginx/ssl:ro" \
    nginx:alpine nginx -t
}

# Reload nginx by stop/start, NOT `nginx -s reload` or `compose up`:
# standalone.conf is a FILE bind-mount (inode-pinned). reload re-reads the stale
# inode; `compose up` sees no spec change (file content isn't part of the spec)
# and won't recreate. Only a stop/start re-resolves the bind mount to the new
# file. The config was already validated above, so this is safe.
reload_nginx() {
  log "=== Reloading standalone-nginx ==="

  # A `docker restart` re-reads the bind-mounted config (refreshing the pinned
  # inode) but CANNOT change the container's spec — most importantly it cannot add
  # a bind-mount. So if the new standalone.conf `include`s a file the LIVE container
  # doesn't have yet (e.g. a freshly added weave-proxy-*.conf), the restart would
  # load a config referencing a missing file and nginx would fail to start, taking
  # the whole edge (prod + staging) DOWN — and validate_nginx above won't catch it
  # because it mounts every include explicitly. Pre-flight, while the container is
  # still up on its old config: confirm every file standalone.conf `include`s already
  # exists inside the running container. If one is missing, abort BEFORE the restart;
  # the container must be RECREATED (only `docker compose up -d` on infra/nginx adds a
  # mount), not merely restarted. Reads fail-open: a missing conf/inspect just skips
  # the guard and leaves the prior behaviour untouched.
  if docker inspect -f '{{.State.Running}}' standalone-nginx 2>/dev/null | grep -q true; then
    local inc missing=0
    while IFS= read -r inc; do
      [ -n "$inc" ] || continue
      docker exec standalone-nginx sh -c '[ -e "$1" ]' _ "$inc" 2>/dev/null \
        || { err "standalone-nginx has no $inc (standalone.conf includes it, but the running container mounts no such file)"; missing=1; }
    done < <(grep -oE '^[[:space:]]*include[[:space:]]+/etc/nginx/[^;[:space:]]+' "$REPO_DIR/infra/nginx/standalone.conf" 2>/dev/null | awk '{print $2}' | sort -u)
    [ "$missing" = 0 ] || die "a required nginx include is absent from the live standalone-nginx container. A restart cannot add a bind-mount — RECREATE it on the host:  cd infra/nginx && docker compose up -d  (then re-run this deploy)."
  fi

  run docker restart standalone-nginx
  sleep 3
  local state
  state=$(docker inspect -f '{{.State.Status}}' standalone-nginx 2>/dev/null || echo missing)
  [ "$state" = running ] || die "standalone-nginx is '$state' after restart"
  run docker exec standalone-nginx nginx -t   # confirm the live config loaded clean
  log "  ok  standalone-nginx running with new config"
}

run_deploy() {
  : "${ENV_NAME:?ENV_NAME required}" "${REPO_DIR:?REPO_DIR required}"
  : "${BRANCH:?BRANCH required}" "${COMPOSE_FILE:?COMPOSE_FILE required}"
  log "=== Deploying ${ENV_NAME} (origin/${BRANCH}) ==="
  [ -d "$REPO_DIR/.git" ]        || die "no git checkout at $REPO_DIR"
  [ -f "$REPO_DIR/$COMPOSE_FILE" ] || die "no $COMPOSE_FILE in $REPO_DIR"

  local prev new
  prev=$("${GIT[@]}" -C "$REPO_DIR" rev-parse HEAD) || die "not a git repo: $REPO_DIR"
  run "${GIT[@]}" -C "$REPO_DIR" fetch origin
  run "${GIT[@]}" -C "$REPO_DIR" reset --hard "origin/$BRANCH"
  new=$("${GIT[@]}" -C "$REPO_DIR" rev-parse HEAD)
  log "checkout now at ${new:0:7} — $("${GIT[@]}" -C "$REPO_DIR" log -1 --pretty=%s)"
  [ "$prev" = "$new" ] && log "(already at this commit — rebuilding anyway in case images changed)"

  ensure_env_files

  log "=== Pre-flight: pruning dangling images ==="
  docker image prune -f || true

  log "=== Building images ==="
  run docker compose -f "$REPO_DIR/$COMPOSE_FILE" build

  log "=== Starting containers ==="
  run docker compose -f "$REPO_DIR/$COMPOSE_FILE" up -d
  verify_containers

  # Touch nginx only when (a) this deploy owns the nginx checkout and (b) its
  # config actually changed in this deploy — a restart blips every site behind
  # the proxy. standalone-nginx mounts its config from ONE checkout (staging), so
  # a prod deploy (MANAGE_NGINX=0) must NOT restart it: that would re-apply the
  # staging checkout's config (never validated by this run) and blip prod+staging
  # for a change prod didn't make.
  if [ "$MANAGE_NGINX" != 1 ]; then
    log "=== nginx managed by another checkout — skipping (MANAGE_NGINX=$MANAGE_NGINX) ==="
  elif "${GIT[@]}" -C "$REPO_DIR" diff --quiet "$prev" "$new" -- infra/nginx; then
    log "=== nginx config unchanged — skipping restart ==="
  else
    validate_nginx
    reload_nginx
  fi

  log "=== ${ENV_NAME} deploy OK ==="
}
