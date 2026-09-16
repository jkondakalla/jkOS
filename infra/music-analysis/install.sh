#!/usr/bin/env bash
# Install the music analysis watcher as a systemd --user unit on this workstation,
# create its delivery key, and print the one line the NAS needs.
#
# Changes THIS machine only. The NAS half (the dataset, the authorized_keys line)
# is printed, never run — it writes another machine's credentials, and that is
# Jag's by design (README.md, steps 1 and 3).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS="$HOME/.config/systemd/user"
ENV_DIR="$HOME/.config/jkos"
ENV_FILE="$ENV_DIR/music-analysis.env"
KEY="$HOME/.ssh/jkos_music_analysis_ed25519"
NAS_USER="truenas_admin"
NAS_HOST="192.168.1.108"
NAS_DIR="/mnt/Luna/jkos-analysis"

# ── The key ──────────────────────────────────────────────────────────────────────
# No passphrase: an unattended service cannot type one. What bounds this key is its
# forced command on the NAS (write two files into one directory, nothing else), not
# a secret on this disk — which is why step 3 is not optional.
if [ ! -f "$KEY" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "jkos-music-analysis@$(hostname)" -f "$KEY"
  echo "created $KEY"
fi
chmod 600 "$KEY"

# ── The environment ──────────────────────────────────────────────────────────────
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# music/analyze.py --watch — read by jkos-music-analyze.service.
# The empty remote path is the rrsync-restricted directory on the NAS.
MUSIC_ANALYSIS_TARGET=${NAS_USER}@${NAS_HOST}:
MUSIC_ANALYSIS_KEY=${KEY}
EOF
  chmod 600 "$ENV_FILE"
  echo "wrote $ENV_FILE"
fi

# ── The unit ─────────────────────────────────────────────────────────────────────
mkdir -p "$UNITS"
ln -sf "$HERE/jkos-music-analyze.service" "$UNITS/jkos-music-analyze.service"
systemctl --user daemon-reload
systemctl --user enable --now jkos-music-analyze.service
loginctl enable-linger "$USER" 2>/dev/null \
  && echo "linger enabled — the watcher runs even when logged out" \
  || echo "NOTE: could not enable linger; run 'sudo loginctl enable-linger $USER' so it runs when logged out"

echo
echo "── On the NAS (README.md step 3) — authorise the key, restricted: ─────────────"
printf "printf 'command=\"/usr/bin/rrsync -wo -no-del %s\",restrict %%s\\\\n' \\\\\n" "$NAS_DIR"
printf "  \"\$(cat %s.pub)\" \\\\\n" "$KEY"
printf "| ssh %s@%s 'cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'\n" "$NAS_USER" "$NAS_HOST"
echo
systemctl --user --no-pager status jkos-music-analyze.service | head -5 || true
