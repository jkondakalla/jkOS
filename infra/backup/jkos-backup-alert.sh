#!/usr/bin/env bash
# jkos-backup-alert.sh — notice when the backup stops working.
#
# ⚠️ AN UNWATCHED BACKUP IS A BACKUP THAT STOPPED WORKING THREE MONTHS AGO. The
# pipeline itself is careful — it fails closed on a missing GPG key, refuses an
# empty payload, proves each archive is real OpenPGP — and every one of those
# refusals is written to a file nobody reads. This is the part that reads it.
#
# THREE FAILURE SHAPES, and only the first one announces itself:
#
#   1. THE RUN FAILED. `jkos-backup.sh` calls `die`, writes `status=FAILED` and
#      exits 1, so systemd marks the unit failed. `--failed` is wired to the
#      service's `OnFailure=` and fires here.
#
#   2. THE RUN WAS KILLED. `TimeoutStartSec=2h`, an OOM, a lid close mid-rsync —
#      `die` never runs, so `last-run.txt` still says `status=OK` from YESTERDAY.
#      Nothing about that file looks wrong; only its AGE does.
#
#   3. THE RUN NEVER HAPPENED. The timer was disabled, linger was never granted
#      so `--user` units die with the session, or the unit file moved. There is no
#      failure to hook, no exit code, and no new line in any log — the whole
#      symptom is an absence. This is the one that costs you three months.
#
# So `--check` is a SEPARATE timer that asks one question of the artifact rather
# than of the process: is `last-run.txt` OK, and is it recent? A checker that ran
# as part of the backup could only ever report on backups that ran.
#
# ⚠️ THE JOURNAL IS THE PRIMARY CHANNEL, the desktop notification is a courtesy.
# A `--user` unit firing at 02:30 has no seat, no display and frequently no
# session bus; `notify-send` there fails, and an alerter whose only channel is the
# one that is absent at 3 a.m. is the same defect one level up. `logger` always
# works, `journalctl -t jkos-backup` always finds it, and the exit code is what
# systemd records.
#
#   jkos-backup-alert.sh --failed    the run just failed (OnFailure=)
#   jkos-backup-alert.sh --check     is the last run OK, and is it recent?
#   jkos-backup-alert.sh --status    print the verdict, exit 0 whatever it is
#
# Canonical copy lives in the repo (infra/backup/). Installed by install.sh.
set -euo pipefail

DEST="${JKOS_BACKUP_DEST:-/media/jag/The Forge/jkos-backups}"
STATUS="$DEST/last-run.txt"
# Three days, not one. The timer is daily but `Persistent=true` catches up on the
# next boot, so a workstation that spent the weekend off is normal and must not
# cry wolf — an alerter people learn to ignore is worse than none. Two missed
# windows in a row is not normal.
MAX_AGE_HOURS="${JKOS_BACKUP_MAX_AGE_HOURS:-72}"
TAG=jkos-backup

say() {   # say <priority> <message…>
  local prio="$1"; shift
  logger -t "$TAG" -p "user.$prio" -- "$*" 2>/dev/null || true
  printf '%s\n' "$*" >&2
}

# Best effort, and deliberately never fatal: see the note above about 02:30.
desktop() {  # desktop <urgency> <summary> <body>
  command -v notify-send >/dev/null 2>&1 || return 0
  notify-send --urgency="$1" --app-name=jkOS -- "$2" "$3" 2>/dev/null || true
}

# `key=value` in, value out. The file is written in that deliberately trivial
# shape precisely so a reader like this one needs no parser — but it is read with
# `grep`/`cut` rather than sourced, because sourcing a file makes every line in it
# executable and this one is written by a script that puts a failure REASON in it.
field() {  # field <key>
  [[ -r "$STATUS" ]] || return 1
  local line; line="$(grep -m1 "^$1=" "$STATUS" 2>/dev/null)" || return 1
  printf '%s' "${line#*=}"
}

verdict() {
  # Prints "<state>\t<detail>"; state is OK | FAILED | STALE | MISSING.
  if [[ ! -r "$STATUS" ]]; then
    printf 'MISSING\tno %s — the backup has never completed on this machine' "$STATUS"
    return
  fi
  local status when reason age_h
  status="$(field status || true)"
  when="$(field when || true)"

  if [[ -n "$when" ]]; then
    local then_s now_s
    then_s="$(date -d "$when" +%s 2>/dev/null || echo 0)"
    now_s="$(date +%s)"
    age_h=$(( (now_s - then_s) / 3600 ))
  else
    age_h=-1
  fi

  if [[ "$status" == "FAILED" ]]; then
    reason="$(field reason || echo 'no reason recorded')"
    printf 'FAILED\tlast run at %s failed: %s' "${when:-unknown}" "$reason"
    return
  fi
  if (( age_h < 0 )); then
    printf 'STALE\t%s has no readable `when=` stamp' "$STATUS"
    return
  fi
  if (( age_h > MAX_AGE_HOURS )); then
    # ⚠️ THE SHAPE THAT LOOKS FINE. status=OK and the file is months old: the run
    # was killed before it could write a failure, or it never started at all.
    printf 'STALE\tthe last SUCCESSFUL backup was %sh ago (%s) — over the %sh limit. status=%s, so nothing failed; it stopped running' \
      "$age_h" "$when" "$MAX_AGE_HOURS" "${status:-unset}"
    return
  fi
  if [[ "$status" != "OK" ]]; then
    printf 'FAILED\tunrecognised status=%s at %s' "${status:-unset}" "${when:-unknown}"
    return
  fi
  printf 'OK\t%sh ago (%s), snapshot %s, %s free' \
    "$age_h" "$when" "$(field snapshot || echo '?')" "$(field dest_free || echo '?')"
}

main() {
  local mode="${1:---check}"
  local v state detail
  v="$(verdict)"
  state="${v%%$'\t'*}"
  detail="${v#*$'\t'}"

  case "$mode" in
    --failed)
      # Reached from OnFailure=, so the run has already failed whatever the file
      # says — never soften this into the file's verdict.
      say err "BACKUP FAILED — $detail"
      desktop critical 'jkOS backup FAILED' "$detail"
      exit 1
      ;;
    --status)
      printf '%s: %s\n' "$state" "$detail"
      exit 0
      ;;
    --check)
      case "$state" in
        OK) say info "backup healthy — $detail"; exit 0 ;;
        STALE)
          say err "BACKUP STALE — $detail"
          desktop critical 'jkOS backup has stopped running' "$detail"
          exit 1 ;;
        *)
          say err "BACKUP $state — $detail"
          desktop critical "jkOS backup: $state" "$detail"
          exit 1 ;;
      esac
      ;;
    *)
      printf 'usage: %s [--check|--failed|--status]\n' "${0##*/}" >&2
      exit 2
      ;;
  esac
}

main "$@"
