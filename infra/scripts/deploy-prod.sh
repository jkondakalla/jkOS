#!/usr/bin/env bash
# jkOS production deploy — reset the prod checkout to a branch and rebuild.
#
# Single source of truth for "Promote to Production": the jkos-deploy controller
# execs this exact script (overriding the env below with in-container paths and
# PROD_BRANCH), and you can run it by hand on the host for the same effect:
#
#   ./infra/scripts/deploy-prod.sh
#
# BRANCH defaults to "staging" because the live setup promotes the exact commit
# just tested on staging.jkos.net (PROD_BRANCH=staging in jkos-deploy). Override
# with BRANCH=main to restore a merge-gated release flow.
#
# Env (all optional; defaults target the host layout):
#   REPO_DIR       checkout to deploy            (default /mnt/Luna/Webhost/jkOS)
#   HOST_REPO_DIR  REPO_DIR as the host sees it  (default = REPO_DIR; for bind mounts)
#   BRANCH         branch to reset to            (default staging)
#   COMPOSE_FILE   compose file in REPO_DIR      (default docker-compose.yml)
#   SSL_PATH       host path to nginx ssl dir    (default /mnt/Luna/Backends/ssl)
set -euo pipefail

# This script lives in the repo it is about to `git reset --hard`, which would
# rewrite this file (and lib-deploy.sh) mid-run. Copy the scripts to a tmp dir
# and re-exec from there so the reset can't corrupt the running shell.
if [ -z "${_DEPLOY_REEXEC:-}" ]; then
  _src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _tmp="$(mktemp -d)"
  cp "$_src"/*.sh "$_tmp"/
  export _DEPLOY_REEXEC=1
  exec bash "$_tmp/$(basename "${BASH_SOURCE[0]}")" "$@"
fi

export ENV_NAME="${ENV_NAME:-production}"
export REPO_DIR="${REPO_DIR:-/mnt/Luna/Webhost/jkOS}"
export BRANCH="${BRANCH:-staging}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
# standalone-nginx bind-mounts its config from the STAGING checkout and fronts
# both prod and staging — so nginx config is deployed by deploy-staging.sh, never
# here. A prod deploy that "saw" an infra/nginx diff would otherwise restart the
# shared proxy with the staging checkout's (unvalidated-this-run) config.
export MANAGE_NGINX="${MANAGE_NGINX:-0}"

source "$(dirname "${BASH_SOURCE[0]}")/lib-deploy.sh"
run_deploy
