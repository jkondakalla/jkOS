#!/usr/bin/env bash
# jkos-backup.sh — pull the jkOS databases off the NAS onto this workstation, encrypted.
#
# DESIGN, and why each choice is the way it is:
#
#  · PULL, never push. This machine initiates and holds the only credential. The NAS has no
#    key, no path and no permission pointing back here — so a compromised or ransomwared NAS
#    cannot reach, corrupt or delete its own backups. This is the single most important
#    property in the file.
#
#  · READ FROM A ZFS SNAPSHOT, never the live dataset. The payload is SQLite. Copying a live
#    .db without its -wal gives a torn or stale database that looks fine until you restore it.
#    A ZFS snapshot is atomic across .db + -wal + -shm together, so the copy is consistent by
#    construction rather than by luck. The hourly snapshot task (pool.snapshottask id 1)
#    produces them; this script picks the newest.
#
#  · THE KEY IS READ-ONLY AND SHELL-LESS. Its authorized_keys entry forces
#    `rrsync -ro /mnt/Luna/Backends/.zfs/snapshot` under `restrict`, so the key cannot get a
#    pty, cannot forward, cannot write, and cannot read one byte outside the snapshot tree.
#    It is deliberately passphrase-less: a passphrase would break unattended backup, and what
#    the key grants is already read-only access to data that leaves here encrypted.
#
#  · THE ARCHIVE IS ENCRYPTED AT REST, and this script FAILS CLOSED if it cannot encrypt.
#    The payload contains password hashes, PLAINTEXT TOTP SECRETS (jkAuth stores the seed
#    unencrypted — see RESET.md JK-A4) and the suite's TLS private key. This drive is
#    unencrypted ext4, so an unencrypted backup here would mean a stolen or discarded disk
#    hands over every user's second factor. Refusing to run beats writing that in the clear.
#
#  · Asymmetric, so automation needs no secret. Encrypting uses only the public key.
#    Decrypting — a manual, rare, deliberate act — needs the passphrase.
#
# RESTORE:
#   gpg --decrypt jkos-prod-YYYYMMDD-HHMM.tar.gz.gpg | tar -xzv -C /some/empty/dir
#   Then stop the service, replace the data dir, start it. Take the .db WITH its -wal/-shm.
#
# Canonical copy lives in the repo (infra/backup/). Install with install.sh.
set -euo pipefail

NAS_USER="${JKOS_NAS_USER:-truenas_admin}"
NAS_HOST="${JKOS_NAS_HOST:-192.168.1.108}"
SSH_KEY="${JKOS_BACKUP_KEY:-$HOME/.ssh/jkos_backup}"
DEST="${JKOS_BACKUP_DEST:-/media/jag/The Forge/jkos-backups}"
GPG_RECIPIENT="${JKOS_BACKUP_GPG:-jkos-backup@emily}"
DAILY_KEEP="${JKOS_DAILY_KEEP:-30}"
WEEKLY_KEEP="${JKOS_WEEKLY_KEEP:-4}"
INCLUDE_STAGING="${JKOS_INCLUDE_STAGING:-weekly}"   # always | weekly | never

STAMP="$(date +%Y%m%d-%H%M)"
LOG="$DEST/backup.log"
STATUS="$DEST/last-run.txt"

log() { printf '%s  %s\n' "$(date -Is)" "$*" | tee -a "$LOG" >&2; }
die() {
  printf '%s  FAILED: %s\n' "$(date -Is)" "$*" | tee -a "$LOG" >&2
  printf 'status=FAILED\nwhen=%s\nreason=%s\n' "$(date -Is)" "$*" > "$STATUS"
  exit 1
}

mkdir -p "$DEST"

# ── Preflight: every one of these is a silent-failure mode if unchecked ──────
[[ -r "$SSH_KEY" ]] || die "no backup ssh key at $SSH_KEY"
command -v gpg  >/dev/null || die "gpg not installed"
command -v rsync >/dev/null || die "rsync not installed"
gpg --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1 \
  || die "no gpg public key for '$GPG_RECIPIENT' — refusing to write an unencrypted backup containing TOTP secrets and a TLS private key. Create it with: gpg --quick-generate-key '$GPG_RECIPIENT' default default never"

SSH_CMD="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

# ── Find the newest snapshot the NAS is offering ─────────────────────────────
# rrsync permits listing inside its root, which is how we discover the name without
# needing shell access to run `zfs list`.
log "discovering snapshots on $NAS_HOST"
SNAP="$(rsync --list-only -e "$SSH_CMD" "$NAS_USER@$NAS_HOST":/ 2>/dev/null \
        | awk '{print $NF}' | grep -E '^auto-[0-9]{8}\.[0-9]{4}' | sort | tail -1)" \
  || die "could not list snapshots (is the restricted key installed on the NAS?)"
[[ -n "$SNAP" ]] || die "no auto-* snapshots found — is pool.snapshottask id 1 still enabled?"
log "newest snapshot: $SNAP"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pull() {  # pull <relative-path-under-snapshot> <local-name>
  local src="$1" name="$2"
  mkdir -p "$WORK/$name"
  rsync -a --numeric-ids -e "$SSH_CMD" \
    "$NAS_USER@$NAS_HOST:/$SNAP/$src/" "$WORK/$name/" \
    || die "rsync failed for $src"
}

seal() {  # seal <local-dir> <archive-prefix>
  local dir="$1" prefix="$2"
  local out="$DEST/$prefix-$STAMP.tar.gz.gpg"
  tar -czf - -C "$WORK" "$dir" \
    | gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" --output "$out" \
    || die "encrypt failed for $prefix"
  # An archive nobody can open is not a backup: prove it is real, well-formed
  # OpenPGP addressed to the right key. (Full decrypt needs the passphrase, so
  # that is the documented manual restore drill, not something to run here.)
  gpg --list-packets < "$out" >/dev/null 2>&1 || die "$out is not readable OpenPGP"
  local bytes; bytes="$(stat -c %s "$out")"
  (( bytes > 512 )) || die "$out is suspiciously small ($bytes bytes)"
  log "wrote $(basename "$out") ($bytes bytes)"
  printf '%s' "$out"
}

rotate() {  # rotate <prefix> <keep>
  local prefix="$1" keep="$2" n=0
  while IFS= read -r f; do
    n=$((n+1)); (( n > keep )) || continue
    rm -f -- "$f" && log "rotated out $(basename "$f")"
  done < <(ls -1t "$DEST/$prefix"-*.tar.gz.gpg 2>/dev/null)
}

# ── Daily: production + the TLS material. ~8.7 MB — the irreplaceable half. ──
log "pulling Production + ssl"
pull "Production" "Production"
pull "ssl"        "ssl"
# Fail loudly if the payload isn't there — an empty backup that "succeeded" is the
# worst outcome available.
find "$WORK/Production" -name '*.db' | grep -q . \
  || die "no .db files under Production — wrong path, or the datasets are empty"
seal "Production" "jkos-prod" >/dev/null
seal "ssl"        "jkos-ssl"  >/dev/null
rotate "jkos-prod" "$DAILY_KEEP"
rotate "jkos-ssl"  "$DAILY_KEEP"

# ── Staging: reproducible test data, so weekly and shallow retention. ────────
do_staging=0
case "$INCLUDE_STAGING" in
  always) do_staging=1 ;;
  weekly) [[ "$(date +%u)" == "7" ]] && do_staging=1 ;;
  never)  do_staging=0 ;;
esac
if (( do_staging )); then
  log "pulling Staging (weekly)"
  pull "Staging" "Staging"
  seal "Staging" "jkos-staging" >/dev/null
  rotate "jkos-staging" "$WEEKLY_KEEP"
fi

DISK_FREE="$(df -h --output=avail "$DEST" | tail -1 | tr -d ' ')"
log "OK — snapshot $SNAP, dest free $DISK_FREE"
printf 'status=OK\nwhen=%s\nsnapshot=%s\ndest_free=%s\n' "$(date -Is)" "$SNAP" "$DISK_FREE" > "$STATUS"
