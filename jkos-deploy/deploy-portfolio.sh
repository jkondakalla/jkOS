#!/usr/bin/env bash
# Publishes the portfolio: main on GitHub -> the folder nginx serves. The Redeploy
# Portfolio button runs this. It lives here, not in infra/scripts, so it ships in the
# controller's image, and not in scripts/, which .dockerignore keeps out of the image.
set -euo pipefail

REPO_URL="${PORTFOLIO_REPO:-https://github.com/jkondakalla/jaaggruthkondakalla.com.git}"
BRANCH="${PORTFOLIO_BRANCH:-main}"
ROOT="${PORTFOLIO_ROOT:-/webhost/Portfolio}"
DOMAIN=jaaggruthkondakalla.com
SITE="$ROOT/site"
RECORD="$ROOT/published-commit"

# A fresh clone each run, in the container's temp space: git can't clone onto this dataset.
CHECKOUT=$(mktemp -d)
trap 'rm -rf "$CHECKOUT"' EXIT

git() { command git -c safe.directory='*' "$@"; }

echo "--- Fetching $BRANCH from GitHub"
git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$CHECKOUT"
git -C "$CHECKOUT" log -1 --format='Publishing %h %s'
[ -f "$CHECKOUT/site/index.html" ] || { echo "site/index.html is missing from this commit"; exit 1; }

echo "--- Copying site/ into place"
# In place, on purpose: nginx bind-mounts $SITE, so swapping the folder with a rename would
# leave it serving the old one. New files inherit the folder's ACL, which is what lets
# nginx's worker read them. mkdir and cat, because this dataset's ACL mode refuses the chmod
# that git, tar and cp all do. _headers isn't published: the nginx block carries those headers.
rm -f "$CHECKOUT/site/_headers"
(
  cd "$CHECKOUT/site"
  find . -type d -print0 | while IFS= read -r -d '' d; do mkdir -p "$SITE/$d"; done
  find . -type f -print0 | while IFS= read -r -d '' f; do cat "$f" > "$SITE/$f"; done
)
cd "$SITE"
find . -type f -print0 | while IFS= read -r -d '' f; do
  [ -e "$CHECKOUT/site/$f" ] || { echo "removing $f"; rm -f -- "$f"; }
done
find . -mindepth 1 -type d -empty -delete

echo "--- Checking what nginx serves"
NGINX_IP=$(getent ahostsv4 standalone-nginx | awk 'NR==1{print $1}') \
  || { echo "standalone-nginx isn't reachable from the deploy controller"; exit 1; }
pages=0
while IFS= read -r -d '' f; do
  path="${f#.}"; path="${path%index.html}"
  curl -fsSk --resolve "$DOMAIN:443:$NGINX_IP" "https://$DOMAIN$path" | cmp - "$f" \
    || { echo "nginx is not serving the published $path"; exit 1; }
  pages=$((pages + 1))
done < <(find . -name index.html -print0)
echo "$pages pages match what was published"

# Read by the console's Portfolio card. Written last, so it only ever names a commit that went out.
git -C "$CHECKOUT" log -1 --format='%H|||%ai|||%s' > "$RECORD"
