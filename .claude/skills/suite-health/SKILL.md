---
name: suite-health
description: Diagnose the health of the jkOS suite — run the gates and probers in order, then map any failure to its known cause and fix. Use when asked to check suite health, triage a red gate / failing CI, verify the suite before/after a deploy, or investigate "is everything wired up / deployed correctly". Covers jkAuth, BeigeBoard, Weave, ORDECK, jkDeploy (skips sylibos).
---

# jkOS suite-health

The diagnosis playbook for the five-system suite. Run the checks in the order below —
each layer is cheaper and more localised than the next, so **stop at the first red layer,
fix it, re-run from there**. Then use the decision table to turn a failure *signature*
into a *fix*. This encodes tribal knowledge that otherwise lives in session notes.

Repo root: `/media/jag/The Forge/jkOS` (the path has a space — quote it). Branch `staging`.
**Off-limits:** `apps/sylibos/`, `services/plex-api/`, `services/recipe-api/` — never edit,
even in a sweep.

## Run order

Run from the repo root. Stop and fix at the first failure; don't push past a red layer.

1. **Typecheck** — `pnpm typecheck`
   Cheapest signal; a type error means the source doesn't cohere. Fix before anything else.

2. **The gate** — `pnpm test:contracts`
   The one command that chains everything: jkAuth contracts + smoke + lifecycle, weave +
   lego, BeigeBoard backend smokes, **the write round-trip** (`pnpm roundtrip`), LazurOS
   backend, `check:tokens`, `check:nginx`, `check:responsive`, `check:drag`, and `pnpm
   prove`. Exit 0 = every hard contract holds. This is the definition of "green".

3. **Individual suspects** (only if you want to localise a gate failure) — run just the
   failing link, e.g.:
   - `pnpm --filter @jkos/jkauth test` (smoke + lifecycle)
   - `pnpm --filter @jkos/beigeboard-backend test` (import + items + delta smokes)
   - `pnpm roundtrip` (the write round-trip; boots BB, dev-stub identity)
   - `pnpm prove` (the read-only cross-system prober)

4. **Live prober** (a DEPLOYED stack only — not part of the offline gate) —
   `pnpm prove --live https://staging.jkos.net` (add `--token <jwt>` or `PROBE_TOKEN` to
   check the authed directory + gated docs). This is the post-deploy smoke: it catches
   "green in git, dead in prod" — a health path that 404s at the edge, a served doc that
   fails `checkDocShape`, a registry drifted from the manifest, or an admin gate that no
   longer refuses an unauthenticated request. It exits non-zero on drift.
   For a write-path live check: `node packages/suite-prober/roundtrip.mjs --live <base>
   --token <jwt>` (safe against staging — it only touches its own `ext_ref:'prober:*'` rows).

## Decision table — failure signature → cause → fix

| Signature (where you see it) | Likely cause | Fix |
|---|---|---|
| **`401` loop / "Subject must be a string"** from the Python side (`/deploy`, jkos_auth.py); a token that verifies in Node but not Python | jkAuth minted a numeric `sub`; `python-jose`/`PyJWT` reject it. ARCH-7.3 CLOSED this: every mint path emits `String(sub)` (`tokens.js`) and `jkos_auth.py` now VERIFIES sub (the `verify_sub:False` workaround was removed). | This signature should now only appear if a mint path regressed to a numeric `sub` — the `apps/jkauth/test/lifecycle.mjs` python cross-verify catches it in the gate. Fix the mint path to emit a string; do NOT re-add `verify_sub:False`. Keep python-jose capped `<3.6.0`. |
| **`check:nginx` fails** ("out of sync") / a new peer's routes 404 at the edge | `weave-proxy*.conf` are GENERATED from the manifest and drifted, OR were regenerated but nginx wasn't restarted | `node infra/nginx/gen-nginx-weave.mjs` to regenerate, commit. On the host, **restart** standalone-nginx (`docker restart standalone-nginx`) — **never reload**: the confs are bind-mounts whose inode pins on git reset (`Documentation/OPERATIONS.md`). Prod deploys skip nginx (`MANAGE_NGINX=0`), so a new peer is inert until a manual restart. |
| A change to `packages/*` (weave/cards/design/ui) doesn't show up in a consumer; a smoke imports a stale shape | pnpm's `.pnpm-copy` — consumers read the installed copy, not your edit | run `pnpm install` to re-propagate, then re-run |
| **ORDECK** behaves wrong under `vite dev` / a `codes.js` CJS import chain error | ORDECK vite dev is broken (CJS `codes.js`) | verify ORDECK via `build` + `preview`, never `dev` |
| **`prove` reports `drift`** (file mode) | two source-of-truth tables that must agree don't (registry vs manifest vs nginx vs docs) | the finding names the two `where:` files — reconcile them to the single manifest source (`packages/suite-manifest/apps.js`); everything derives from it |
| **`prove --live` `live-health` drift** | app advertised in the registry but dead / 404 at the edge (container down, nginx block inert) | check the container is up and the nginx peer block exists + nginx was restarted (see nginx row) |
| **`prove --live` `live-gate` drift** (admin gate returns 2xx unauthenticated) | the `auth_request` gate is inert / bypassed — the deployment is OPEN | fix the nginx gate config immediately; this is a security exposure, not a warning |
| **`prove --live` `live-docshape` drift** | the deployed app serves a stale or malformed capability/dataset doc | redeploy the app; the served doc must match its committed `discovery.js`/`docs.js` |
| **BeigeBoard sync wipes calendar rows** / secrets stored plaintext | `CALENDAR_ENC_KEY` unset (BUG-5) | ensure the key is in both compose files + the host env (`openssl rand -hex 32`); see the key-lifecycle note in `Documentation/OPERATIONS.md` (adding a key is a safe dual-read; removing one after encryption breaks old rows) |
| **`roundtrip` fails at "discover"** | BeigeBoard capability/dataset doc changed shape or an endpoint moved | the round-trip only uses discovered shapes — a discover failure means the served docs and routes disagree; reconcile `discovery.js` with the routes in `server.js` |

## Reference docs

- `Documentation/TESTING.md` — the full test inventory (what every test asserts), the gate
  anatomy, the prober's operating model, house patterns for new tests
- `Documentation/PRIMITIVES.md` — the command catalog: every gate/check/prober invocation
  with flags, plus the cross-cutting gotchas table
- `Documentation/OPERATIONS.md` — nginx topology, restart-not-reload, key lifecycle,
  deploy flow, break-glass access

## What "healthy" means

`pnpm typecheck` clean · `pnpm test:contracts` exit 0 (0 drift) · and, for a deployment,
`pnpm prove --live <base>` exit 0 with `live-health`/`live-gate`/`live-docshape` all ✓.
