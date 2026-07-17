---
name: new-tester
description: Author a new jkOS suite test (smoke, contract gate, or prober probe) in the house pattern and wire it into the gate. Use when asked to add a test / smoke / probe / conformance check for a backend, package, or contract, or when a new feature needs coverage that keeps the suite's testing style uniform. Covers the boot-real-server smoke, the text-scan gate, the transpile-pure-logic unit test, and the prober probe — with the checklist to chain each into `pnpm test:contracts`.
---

# jkOS new-tester

The suite's tests all follow a few fixed shapes so any one is legible to someone who's read
another. This skill picks the right shape for what you're covering, points at the exemplar to
copy, and gives the wiring checklist so the test actually runs in the gate. **Copy an existing
test — don't invent a new style.**

Repo root: `/media/jag/The Forge/jkOS` (path has a space — quote it). Branch `staging`.
**Off-limits:** `apps/sylibos/` — never add tests that edit or boot it.

Golden rule: **a test must exercise the REAL code, never a re-implementation.** Boot the real
server, transpile the real module, drive the real function. A test that reimplements the logic
it checks passes forever while the real code rots.

## 1 · Pick the shape

| You're covering… | Shape | Copy this exemplar |
|---|---|---|
| A backend HTTP contract (routes, auth, validation, a job/import flow) | **boot-real-server smoke** | [apps/beigeboard/backend/test/import.smoke.mjs](../../../apps/beigeboard/backend/test/import.smoke.mjs) · [apps/lazuros/backend/test/worker-e2e.smoke.mjs](../../../apps/lazuros/backend/test/worker-e2e.smoke.mjs) |
| Pure logic in a TS package (date math, a reducer, a merge/heal fn) | **transpile-pure-logic unit test** | [test/cards-logic.mjs](../../../test/cards-logic.mjs) · [apps/ordeck/scripts/check-hud-doc.mjs](../../../apps/ordeck/scripts/check-hud-doc.mjs) |
| A "must not regress" invariant across files (no forbidden import/class/literal) | **text-scan gate** | [test/drag.mjs](../../../test/drag.mjs) · [test/cards-purity.mjs](../../../test/cards-purity.mjs) · [test/tokens-parity.mjs](../../../test/tokens-parity.mjs) |
| A cross-app declared-vs-enforced or topology invariant | **prober probe** | [packages/suite-prober/src/probes/](../../../packages/suite-prober/src/probes/) (e.g. `95-env-conformance.mjs`) |
| A node↔python cross-runtime contract | **contracts bridge** | [apps/jkauth/test/contracts.mjs](../../../apps/jkauth/test/contracts.mjs) §3 (spawns `python3`, jose-only) |

## 2 · House pattern — boot-real-server smoke

The load-bearing shape. Boot the actual server on a throwaway port against a temp SQLite DB with
weave's dev-stub auth, assert over real HTTP, tear down. Skeleton:

```js
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'jkos-<name>-'));
const DB_PATH = join(tmp, 'test.db');
let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.error('  ✗ ' + msg)); };

// Boot: NO JKOS_AUTH_* env → weave injects the dev-stub user { sub:1, role:'admin' }.
const proc = spawn('node', ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT, DB_PATH }, stdio: [...] });
// waitForHealth() polls GET /health until 200 (copy import.smoke's helper).
// …assert with fetch()…
// finally: proc.kill('SIGKILL'); rmSync(tmp, { recursive: true, force: true });
```

Non-negotiables:
- **Throwaway port + temp DB**, cleaned in a `finally`. Never touch a real DB or a fixed shared port.
- **Real HTTP**, not in-process handler calls — the middleware stack (auth, cors, write-gate) is
  part of the contract.
- **Dev-stub auth**: leave `JKOS_AUTH_PUBLIC_KEY`/`JKOS_AUTH_JWKS_URI` unset → `sub:1, role:'admin'`.
  The write-gate lets an admin through with no `scope` claim, so writes work. Need a service/guest
  identity or a real signed token? Forge RS256 tokens like [items.smoke.mjs](../../../apps/beigeboard/backend/test/items.smoke.mjs).
- **Event-loop trap**: if your test runs an in-process fake HTTP server (a stub Ollama/peer) AND
  drives a child that calls it, spawn the child **async** (`spawn` + await close), never `spawnSync`
  — a sync child blocks the loop so the in-process server can't answer, and you deadlock. (This is
  exactly what worker-e2e.smoke.mjs documents.)

## 3 · House pattern — transpile a pure TS module

Node has no TS runner here, so transpile the module in-memory with the repo's own `typescript`
dep and import the emitted JS — driving the REAL function. Copy `importTs()` from
[test/cards-logic.mjs](../../../test/cards-logic.mjs). For a small dependency graph (a module that
imports a couple of siblings + one or two external packages), copy the specifier-rewrite + stub
approach in [apps/ordeck/scripts/check-hud-doc.mjs](../../../apps/ordeck/scripts/check-hud-doc.mjs)
(rewrite bare imports to temp-dir siblings/stubs, stub only the non-pure leaves). No new dep, no
bundler, and **remember `pnpm install` after editing `packages/*`** or dev consumers won't see it.

## 4 · House pattern — text-scan gate

Read files, comment-strip, assert a forbidden pattern is absent (or a required export present).
Cheap, runs with plain `node:fs`. Use `fail()`/`ok()` + a summary that `process.exit(1)`s on any
failure. Copy [test/drag.mjs](../../../test/drag.mjs). **Prove it catches drift**: temporarily
mutate a file to the bad state and confirm it fails — but do it on a **scratchpad copy**, NEVER via
`git checkout <file>` (that discards the tree's uncommitted WIP).

## 5 · Style contract (all shapes)

- A top comment that says WHY the test exists (the bug class it guards) + the run command.
- `✓`/`✗` lines, a final one-line summary, and **exit non-zero on any failure** (the gate keys off
  the exit code).
- Deterministic + hermetic: no network to real services, no reliance on wall-clock, `TZ=UTC` if you
  assert on dates. Clean up every temp file/port/process.
- Name it `*.smoke.mjs` (server smokes, in the app's `test/`), `test/*.mjs` or `check-*.mjs` (root
  gates), or `NN-*.mjs` (prober probes).

## 6 · Wire it into the gate — the step everyone forgets

A test that isn't chained runs never. Pick the right hook:

- **Backend smoke** → add to that package's `test` script (`apps/<app>/backend/package.json`). The
  root gate already runs `pnpm --filter @jkos/<app>-backend test`.
- **Root gate scan / unit test** → add a `check:<x>`/`test:<x>` script in the **root**
  [package.json](../../../package.json) and append it to the `test:contracts` chain (that's how
  `check:hud`, `check:cards`, `test:cards`, `check:tokens` are wired).
- **Prober probe** → drop `NN-*.mjs` in `packages/suite-prober/src/probes/`; `pnpm prove` discovers
  it. Add a pathway/row so `--live` mode exercises it too if it has a live counterpart.
- **Cross-runtime** → extend the existing python bridge in `contracts.mjs` (guarded by its
  `import jose` probe) rather than adding a second python entry point.

Then **run `pnpm test:contracts` and confirm it's green (EXIT 0)** — and that your new test's
lines actually appear in the output (grep for one of its `✓` messages). A test that's wired but
silently skipped is worse than none.

## 7 · Checklist

- [ ] Right shape chosen; copied the exemplar (not a fresh style).
- [ ] Exercises the REAL code (booted server / transpiled module / scanned source).
- [ ] Hermetic: throwaway port + temp DB/dir, cleaned in `finally`; no real services.
- [ ] Exits non-zero on failure; has a WHY comment + run command.
- [ ] Chained into `test:contracts` (or the relevant package `test` / `pnpm prove`).
- [ ] `pnpm test:contracts` green, and the new test's ✓ lines show in the output.
- [ ] If it pairs a fix, the test FAILED before the fix (write it first).
