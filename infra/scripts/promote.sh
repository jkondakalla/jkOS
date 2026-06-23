#!/usr/bin/env bash
# Alias for deploy-prod.sh — "promote staging to production". Kept as a separate
# name because the docs/muscle-memory call this step "promote".
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-prod.sh" "$@"
