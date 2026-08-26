#!/usr/bin/env bash
# Install the backup timer as a systemd --user unit on this workstation.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS="$HOME/.config/systemd/user"
mkdir -p "$UNITS"
ln -sf "$HERE/jkos-backup.service" "$UNITS/jkos-backup.service"
ln -sf "$HERE/jkos-backup.timer"   "$UNITS/jkos-backup.timer"
systemctl --user daemon-reload
systemctl --user enable --now jkos-backup.timer
# Without linger, a --user timer only runs while a session is open. Best effort:
# this needs polkit permission and may prompt or fail harmlessly.
loginctl enable-linger "$USER" 2>/dev/null \
  && echo "linger enabled — the timer runs even when logged out" \
  || echo "NOTE: could not enable linger; run 'sudo loginctl enable-linger $USER' so the timer runs when logged out"
echo
systemctl --user list-timers jkos-backup.timer --no-pager
