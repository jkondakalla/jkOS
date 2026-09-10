#!/usr/bin/env bash
# Install the backup timer as a systemd --user unit on this workstation.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS="$HOME/.config/systemd/user"
mkdir -p "$UNITS"
ln -sf "$HERE/jkos-backup.service" "$UNITS/jkos-backup.service"
ln -sf "$HERE/jkos-backup.timer"   "$UNITS/jkos-backup.timer"
# The watcher. Two units, because the two failure shapes have nothing in common:
# `-alert` is hooked to the backup's OnFailure= and fires when a run FAILS;
# `-check` is its own timer and fires when a run stops HAPPENING. Only the first
# has an exit code to hook — see jkos-backup-alert.sh's header.
ln -sf "$HERE/jkos-backup-alert.service" "$UNITS/jkos-backup-alert.service"
ln -sf "$HERE/jkos-backup-check.service" "$UNITS/jkos-backup-check.service"
ln -sf "$HERE/jkos-backup-check.timer"   "$UNITS/jkos-backup-check.timer"
systemctl --user daemon-reload
systemctl --user enable --now jkos-backup.timer
systemctl --user enable --now jkos-backup-check.timer
# Without linger, a --user timer only runs while a session is open. Best effort:
# this needs polkit permission and may prompt or fail harmlessly.
loginctl enable-linger "$USER" 2>/dev/null \
  && echo "linger enabled — the timer runs even when logged out" \
  || echo "NOTE: could not enable linger; run 'sudo loginctl enable-linger $USER' so the timer runs when logged out"
echo
systemctl --user list-timers 'jkos-backup*.timer' --no-pager
echo
# Say the verdict out loud at install time. The first run of this on a machine
# that had been backing up "fine" for weeks is how the fifteen-day GPG failure
# was found.
"$HERE/jkos-backup-alert.sh" --status || true
