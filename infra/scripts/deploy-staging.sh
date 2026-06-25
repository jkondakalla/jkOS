#!/usr/bin/env bash
# jkOS staging deploy — sync the staging checkout to origin and rebuild.
#
# This is the single source of truth for "Sync Staging from GitHub": the
# jkos-deploy controller execs this exact script (overriding the env below with
# the in-container paths), and you can run it by hand on the host for the same
# effect:
#
#   ./infra/scripts/deploy-staging.sh
#
# Env (all optional; defaults target the host layout):
#   REPO_DIR       checkout to deploy            (default /mnt/Luna/Webhost/jkOS-staging)
#   HOST_REPO_DIR  REPO_DIR as the host sees it  (default = REPO_DIR; for bind mounts)
#   BRANCH         branch to reset to            (default staging)
#   COMPOSE_FILE   compose file in REPO_DIR      (default docker-compose.staging.yml)
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

export ENV_NAME="${ENV_NAME:-staging}"
export REPO_DIR="${REPO_DIR:-/mnt/Luna/Webhost/jkOS-staging}"
export BRANCH="${BRANCH:-staging}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"

source "$(dirname "${BASH_SOURCE[0]}")/lib-deploy.sh"
run_deploy
