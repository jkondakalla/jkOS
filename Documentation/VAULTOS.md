# VaultOS — parked program

**Status: PARKED (2026-07-13, Jag).** TrueNAS + ZFS already cover the need — snapshots, shares,
and per-dataset ACLs are handled at the storage layer. VaultOS is **not a priority**. Nothing
here is blocking anything; this document exists so the design work isn't lost.

Moved out of [ToDo.md](ToDo.md) §2 on 2026-07-13. Pick it up by choice, not by schedule.

---

## What it was going to be

`vault`, port 3011 — **working name, id NOT final**. A TrueNAS file browser with per-share ACLs
and hard path containment. Multi-user, gated by jkAuth, hand-rolled HTTP Range streaming and
path handling.

**Blocked on the name before anything else.** The id bakes into scope / edge / bus-key and is
painful to rename later. Candidates floated: CofferOS / SiloOS / StacksOS.

---

## One consequence of parking it

VaultOS was going to be the **second consumer** that proved the `@jkos/files` seam
(`rangeStream` + `containPath`) — that was the whole reason the extraction waited.

**The music app now plays that role instead** (see [ToDo.md](ToDo.md) §3, Wave 17.1). So parking
VaultOS *unblocks* the files extraction rather than stalling it. The doctrine is satisfied by a
different second consumer.

---

## The program (as specced, unbuilt)

### Wave 9 — scaffold + wiring `[ARCH]`

`pnpm new-app <final-id> --name "<FinalName>" --port 3011` + `pnpm install`; set
**`datasets:false`** in the emitted `APPS` row (v1 serves no dataset — the scaffolder defaults it
on); keep `api` / `capabilities` / `health` / `edge:'standard'`.

Compose (both files): data volume + `${VAULT_CONFIG_PATH:-…}/shares.json:/config/shares.json:ro`
+ **one bind-mount per share** (`:ro` for read-only shares — the mount is the outer guard,
`shares.json` the inner) + the root staging include (manual — the scaffolder does not patch it).
Author `shares.json` from Jag's share matrix; `.env` from example; prober `BACKEND_DOCS` row;
gate green.

### Wave 10 — shares config + access core (the security heart)

- `backend/src/shares.js`: load + **boot-validate** `SHARES_CONFIG` (every `root` exists, ids
  unique, access rows well-formed) — fail fast on a bad config (the LazurOS mounted-config
  precedent). Schema per share:
  `{ id, label, root, access:[ {role:'admin'|'user', mode:'rw'|'ro'} | {sub:'<jkAuth sub>', mode} ] }`.
- `backend/src/access.js` `[opus]`: `visibleShares(user)`; `resolve(user, shareId, relPath, need)`
  → `{absPath, mode}` or throws `FORBIDDEN` / `NOT_FOUND` `authError` (reuse `CODES` from
  `packages/auth-middleware/codes.js`). Mode = highest matching grant (`rw` > `ro`); writes
  require `rw` **and** the `vault:write` scope; admin = `req.user.role === 'admin'` inline.
  **Containment:** `path.resolve(share.root, rel)` → `fs.realpath` → assert the result is inside
  `fs.realpath(share.root)` — rejects `..`, absolute inputs, symlink escapes. Pure, dep-light.
- Containment unit test (new-tester, chained): `../` escape, absolute path, symlink outside the
  share, `ro` vs `rw` resolution, write denied without `rw`, visibility filtered by role + sub.
- `discovery.js` `CAPABILITIES` doc: `listDir` / `download` / `upload` / `mkdir` / `move` /
  `delete` / `reloadShares` with `vault:write` / `vault:admin` scopes; passes `checkDocShape`.

### Wave 11 — filesystem routes

*(every route calls `access.resolve` first)*

`GET /api/vault/shares` (caller's `visibleShares`); `GET /api/vault/fs/:share/*` (readdir + stat,
dirs first, hidden filtered by policy); `GET /api/vault/download/:share/*` (Range `206` +
`Content-Disposition`); `PUT/POST /api/vault/upload/:share/*` (`busboy` streamed to temp then
**atomic rename**, max-size + free-space check, `rw` + `vault:write`, default 2 GB);
`POST mkdir` / `move` (re-resolve **both** ends through containment) / `DELETE rm`;
`POST reload-shares` (`vault:admin`).

Backend smoke: visible-shares filtering, listing shape, Range → `206`, an upload lands on disk,
`..` → `403`.

**Note:** if this is ever revived, download/Range should consume `@jkos/files` (ToDo §3 Wave 17.1)
rather than hand-rolling — by then the primitive will exist and be proven by two media apps.

### Wave 12 — frontend explorer

*(12.2–12.4 ∥ after 12.1)*. Shell (vault/steel accent, `AuthGuard`, `authFetch`, share-picker
tiles, vite `commonjsOptions.include` mirror); explorer (breadcrumb, list/grid, sort, type icons,
`ro` shares hide write affordances — backend re-checks regardless); upload dropzone (streamed
`PUT` with progress, `rw` only) + download; ops (new folder, rename, move, delete-with-confirm).

### Wave 13 — staging bring-up + live verify `[ARCH/ops]`

Deploy + nginx **recreate** (not reload — bind-mount inodes); live: a `user` sees only granted
shares while `admin` sees all, a no-grant user sees nothing; download + upload on a `rw` share;
mkdir / rename / delete; `Range: bytes=0-1023` → `206`; suite-health; promote. Then an
ARCHITECTURE.md section.

### Wave 14 — parked futures (record only)

DB-backed grants `defineCollection` + admin UI (`shares.json` stays the mount + default-policy
source); audit-log collection (then flip `datasets:true`); per-share quotas; Weave `files`
capability; ORDECK recent-files widget; thumbnails/previews, server-side search, zip-folder
download, trash/versioning.

---

## Decisions that were still open

| Decision | Blocks | Default if unspecified |
|---|---|---|
| Final name (CofferOS / SiloOS / StacksOS / …) | all of W9–W14 | none — id bakes into scope/edge/bus-key |
| Which TrueNAS datasets become shares + per-role/user `ro`/`rw` policy | 9.2 / 9.3 | none |
| Upload max size / per-share quota for v1 | 11.3 | 2 GB max, no quota |
| DNS `<vault>.jkos.net` | prod promote only | staging path-based works without |
