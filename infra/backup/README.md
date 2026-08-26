# jkOS backup — off-box, on your own hardware

The jkOS databases are pulled from the NAS onto this workstation, encrypted at rest, on a
daily timer. **Nothing leaves your hardware and no third party holds a credential.**

## The two layers

| Layer | What it covers | Where it lives |
|---|---|---|
| **On-box snapshots** | a bad migration, a wrong `DELETE`, "it was fine an hour ago" | ZFS, `pool.snapshottask` id 1 — `Luna/Backends`, recursive, hourly, 30-day retention |
| **Off-box archives** | losing the NAS entirely — pool death, theft, fire, ransomware | this machine, `/media/jag/The Forge/jkos-backups/`, GPG-encrypted |

A snapshot on the same pool is not a backup. Both layers are needed and they fail differently.

## Why it is built this way

**Pull, never push.** This workstation initiates and holds the only credential. The NAS has no
key, no path, and no permission pointing back here — so a compromised NAS cannot reach, corrupt,
or delete its own backups. This is the property everything else is arranged around.

**Reads a ZFS snapshot, never the live dataset.** The payload is SQLite. Copying a live `.db`
without its `-wal` gives a torn or stale database that looks fine until the day you restore it.
A snapshot is atomic across `.db` + `-wal` + `-shm`, so consistency is structural rather than
lucky.

**The key is read-only and shell-less.** Its `authorized_keys` entry forces
`rrsync -ro /mnt/Luna/Backends/.zfs/snapshot` under `restrict`: no pty, no forwarding, no writes,
and no reads outside the snapshot tree. It carries no passphrase on purpose — a passphrase breaks
unattended backup, and what the key grants is read access to data that leaves here encrypted.

**Encrypted at rest, and it fails closed.** The archive contains password hashes, **plaintext
TOTP secrets** (jkAuth stores seeds unencrypted — RESET.md **JK-A4**) and the suite's **TLS
private key**. This drive is unencrypted ext4, so a stolen or discarded disk would otherwise hand
over every user's second factor. If the GPG key is missing the script **refuses to run** rather
than writing that in the clear.

## Setup — two commands, both yours to run

Everything else is already in place. These two need your hands: one writes to the NAS, one needs
a passphrase only you should know.

**1 · Authorise the restricted key on the NAS.**

```bash
printf 'command="/usr/bin/rrsync -ro /mnt/Luna/Backends/.zfs/snapshot",restrict %s\n' \
  "$(cat ~/.ssh/jkos_backup.pub)" \
| ssh truenas_admin@192.168.1.108 'cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

**2 · Create the backup encryption key.** Choose a real passphrase and **store it in your password
manager** — it is the only thing standing between a stolen disk and every user's 2FA seed, and a
backup you cannot decrypt is not a backup.

```bash
gpg --quick-generate-key 'jkos-backup@emily' default default never
```

**Then install the timer and take the first backup:**

```bash
/media/jag/The\ Forge/jkOS/infra/backup/install.sh
systemctl --user start jkos-backup.service
cat /media/jag/The\ Forge/jkos-backups/last-run.txt
```

## What it produces

```
jkos-prod-YYYYMMDD-HHMM.tar.gz.gpg      daily, keep 30   ~8.7 MB   ← the irreplaceable half
jkos-ssl-YYYYMMDD-HHMM.tar.gz.gpg       daily, keep 30   ~3 KB
jkos-staging-YYYYMMDD-HHMM.tar.gz.gpg   Sundays, keep 4  ~31 GB    ← reproducible test data
backup.log                              append-only run log
last-run.txt                            status=OK|FAILED + snapshot + free space
```

Staging is bulky and reproducible, so it runs weekly with shallow retention. Set
`JKOS_INCLUDE_STAGING=never` to drop it entirely, or `always` for daily.

## Restore

```bash
gpg --decrypt jkos-prod-YYYYMMDD-HHMM.tar.gz.gpg | tar -xzv -C /some/empty/dir
```

Stop the service, replace its data directory, start it. **Take each `.db` together with its
`-wal` and `-shm`** — that is why the snapshot is read atomically in the first place.

## Checking on it

```bash
systemctl --user list-timers jkos-backup.timer
cat "/media/jag/The Forge/jkos-backups/last-run.txt"
tail -20 "/media/jag/The Forge/jkos-backups/backup.log"
```

⚠️ **An unwatched backup is a backup that stopped working three months ago.** Nothing currently
alerts on `status=FAILED`. `last-run.txt` is written in a deliberately trivial `key=value` shape so
a HUD widget can read it — that is the natural home for this once the fabric work lands.

## Restore drill

Test a real restore at least once, and after any change to this pipeline. The drill is: decrypt
the newest `jkos-prod` archive into a scratch directory, point a local BeigeBoard at the restored
`.db`, and confirm it opens and the row counts look right. **A backup that has never been restored
is a hypothesis.**

## Tuning

Every knob is an environment variable read by the script: `JKOS_NAS_HOST`, `JKOS_BACKUP_KEY`,
`JKOS_BACKUP_DEST`, `JKOS_BACKUP_GPG`, `JKOS_DAILY_KEEP`, `JKOS_WEEKLY_KEEP`,
`JKOS_INCLUDE_STAGING`. Optional extra hardening: add `from="<this machine's IP>"` to the
`authorized_keys` entry. Left off by default because a DHCP change would silently stop the backup,
and availability beats a marginal restriction on an already read-only key.
