#!/usr/bin/env bash
# selftest.sh — TEST-14: dry-run the deploy pipeline WITHOUT touching the live stack.
#
# jkos-deploy is the recovery tool — the thing you reach for when the suite is down —
# yet its own pipeline (lib-deploy.sh + the generated nginx config + the /deploy auth
# gate) had no test. A broken compose file or a generated nginx conf that fails to load
# only surfaced DURING a real deploy, i.e. mid-outage. This validates all three, offline
# and non-destructively:
#
#   (a) the deploy scripts parse + carry the expected steps (fetch/reset/health-verify);
#       every compose file in the tree passes `docker compose config` (validate, never
#       `up`) — the "compose replaced by config" dry-run.
#   (b) the CURRENT standalone.conf + its includes load clean in a throwaway nginx
#       container (the exact pre-flight lib-deploy.sh runs before restarting the edge).
#   (c) the /deploy admin gate: the break-glass + verifier decisions are asserted in the
#       gate (`pnpm --filter @jkos/jkauth test:contracts`, ARCH-8 + numeric-sub); this
#       re-runs the break-glass gates host-side as a fast confidence check.
#
# Read-only: no git fetch, no image build, no container start, no nginx restart. Steps
# needing docker/openssl SKIP cleanly (exit 0) when the tool is absent, so it runs on a
# dev box too. Run on the TrueNAS host before a risky deploy, or in CI with docker.
#
#   bash jkos-deploy/scripts/selftest.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
scripts="$repo/infra/scripts"

pass=0; fail=0; skip=0
ok()   { echo "  ✓ $*"; pass=$((pass+1)); }
bad()  { echo "  ✗ $*"; fail=$((fail+1)); }
note() { echo "  ⊘ SKIP $*"; skip=$((skip+1)); }
have() { command -v "$1" >/dev/null 2>&1; }
# Is the docker DAEMON reachable? `compose config` is client-side (no daemon), but
# `docker run` (the nginx pre-flight) needs the socket — skip it if we can't reach it.
daemon_ok() { docker info >/dev/null 2>&1; }

# Empty env-file stubs we create so `compose config` can resolve `env_file:` in a
# SECRETLESS checkout (the real .env exists on the deploy host). Cleaned on exit —
# validation checks compose STRUCTURE, not that secrets are present.
CREATED_ENVS=()
cleanup() { for f in "${CREATED_ENVS[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done; }
trap cleanup EXIT

# Validate one compose file, auto-stubbing any missing env_file it names (the error
# reports the exact path — which may contain spaces, so slice, don't tokenise).
validate_compose() {
  local cf="$1" err path
  for _ in 1 2 3 4 5 6; do
    if err=$(docker compose -f "$cf" config -q 2>&1); then return 0; fi
    path=$(printf '%s\n' "$err" | sed -nE 's/.*env file (.+) not found.*/\1/p' | head -1)
    if [ -n "$path" ] && [ ! -e "$path" ]; then
      touch "$path" 2>/dev/null && CREATED_ENVS+=("$path") && continue
    fi
    COMPOSE_ERR="$err"; return 1
  done
  COMPOSE_ERR="$err"; return 1
}

echo "=== (a) deploy scripts parse + carry the pipeline steps ==="
for s in lib-deploy.sh deploy-staging.sh deploy-prod.sh promote.sh; do
  if [ -f "$scripts/$s" ]; then
    if bash -n "$scripts/$s"; then ok "$s parses (bash -n)"; else bad "$s has a syntax error"; fi
  else bad "$scripts/$s is missing"; fi
done
# The recovery routine must keep its shape — a refactor that drops the health-verify or
# the hard reset would make a "green" deploy meaningless. Pin the load-bearing steps.
lib="$scripts/lib-deploy.sh"
for pat in 'fetch origin' 'reset --hard' 'verify_containers' 'validate_nginx' 'reload_nginx'; do
  if grep -q "$pat" "$lib"; then ok "lib-deploy.sh still performs: $pat"; else bad "lib-deploy.sh no longer references: $pat"; fi
done

echo "=== (a) every compose file validates (docker compose config — no start) ==="
if have docker && docker compose version >/dev/null 2>&1; then
  while IFS= read -r cf; do
    case "$cf" in */node_modules/*|*/scripts/templates/*) continue;; esac
    if validate_compose "$cf"; then
      ok "compose valid: ${cf#$repo/}"
    else
      bad "compose INVALID: ${cf#$repo/} — $(printf '%s' "$COMPOSE_ERR" | tr '\n' ' ' | head -c 200)"
    fi
  done < <(find "$repo" -name 'docker-compose*.yml' -not -path '*/node_modules/*')
else
  note "docker (compose) unavailable — compose validation skipped"
fi

echo "=== (b) standalone.conf + includes load in a throwaway nginx container ==="
sconf="$repo/infra/nginx/standalone.conf"
if ! [ -f "$sconf" ]; then
  bad "infra/nginx/standalone.conf missing"
elif ! have docker; then
  note "docker unavailable — nginx config validation skipped"
elif ! daemon_ok; then
  note "docker daemon unreachable (no socket access here) — nginx validation skipped"
else
  tmpssl="$(mktemp -d)"
  cert_ok=1
  if have openssl; then
    openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmpssl/key.pem" -out "$tmpssl/cert.pem" \
      -days 1 -subj "/CN=selftest" >/dev/null 2>&1 || cert_ok=0
  else cert_ok=0; fi
  if [ "$cert_ok" != 1 ]; then
    note "openssl unavailable — cannot forge a throwaway cert; nginx validation skipped"
  else
    # Mount standalone.conf as the main config + every repo file it includes (the same
    # include-derivation lib-deploy.sh's validate_nginx uses, so the mount list can't drift).
    mounts=(-v "$sconf:/etc/nginx/nginx.conf:ro")
    while IFS= read -r inc; do
      [ -n "$inc" ] || continue
      base="$(basename "$inc")"
      [ -f "$repo/infra/nginx/$base" ] || continue
      mounts+=(-v "$repo/infra/nginx/$base:$inc:ro")
    done < <(grep -oE '^[[:space:]]*include[[:space:]]+/etc/nginx/[^;[:space:]]+' "$sconf" | awk '{print $2}' | sort -u)
    if docker run --rm --add-host host.docker.internal:host-gateway \
         "${mounts[@]}" -v "$tmpssl:/etc/nginx/ssl:ro" \
         nginx:alpine nginx -t >/tmp/jkos-selftest-nginx.log 2>&1; then
      ok "standalone.conf + includes pass nginx -t"
    else
      bad "nginx -t FAILED — $(tail -3 /tmp/jkos-selftest-nginx.log | tr '\n' ' ')"
    fi
    rm -f /tmp/jkos-selftest-nginx.log
  fi
  rm -rf "$tmpssl"
fi

echo "=== (c) /deploy break-glass gate (host-side confidence; full smoke is in the gate) ==="
py="${CONTRACTS_PYTHON:-python3}"
if have "$py" && "$py" -c 'import jose' >/dev/null 2>&1; then
  if BREAK_GLASS_TOKEN=selftest-glass "$py" - "$here/.." <<'PY'
import sys, os
sys.path.insert(0, sys.argv[1])
import jkos_auth
from jose import JWTError
def raises(f):
    try: f(); return False
    except JWTError: return True
# no JWKS configured → jkAuth "unreachable" → the configured+matching token is accepted
p = jkos_auth.verify_break_glass('selftest-glass')
assert p['role'] == 'admin' and p.get('break_glass') is True
assert raises(lambda: jkos_auth.verify_break_glass('wrong'))
jkos_auth.jkauth_reachable = lambda: True
assert raises(lambda: jkos_auth.verify_break_glass('selftest-glass'))  # inert while SSO up
print('ok')
PY
  then ok "break-glass accepts only when configured+matching+jkAuth-unreachable"
  else bad "break-glass gate assertions failed"; fi
else
  note "$py / python-jose unavailable — break-glass host check skipped (still enforced in the gate)"
fi

echo
echo "── selftest: $pass ok, $fail failed, $skip skipped ──"
[ "$fail" -eq 0 ] || { echo "✗ deploy self-test FAILED"; exit 1; }
echo "✓ deploy pipeline dry-run OK"
