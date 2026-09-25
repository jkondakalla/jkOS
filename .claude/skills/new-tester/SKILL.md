---
name: new-tester
description: Author a new jkOS suite test (smoke, contract gate, or prober probe) in the house pattern and wire it into the gate. Use when asked to add a test / smoke / probe / conformance check for a backend, package, or contract, or when a new feature needs coverage that keeps the suite's testing style uniform. Covers the boot-real-server smoke, the text-scan gate, the transpile-pure-logic unit test, and the prober probe — with the checklist to get each into `pnpm test:contracts`.
---

# jkOS new-tester

The suite's tests all follow a few fixed shapes so any one is legible to someone who's read
another. This skill picks the right shape for what you're covering, points at the exemplar to
copy, and gives the wiring checklist so the test actually runs in the gate. **Copy an existing
test — don't invent a new style.**

Repo root: `/media/jag/The Forge/jkOS` (path has a space — quote it). Branch `staging`.

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
weave's dev-stub auth, assert over real HTTP, tear down. **Use
[test/lib/smoke.mjs](../../../test/lib/smoke.mjs)** — it holds the harness contract (TESTING.md) so
you don't copy it. Skeleton:

```js
import { join } from 'node:path';
import { smoke } from '../../../../test/lib/smoke.mjs';

const PORT = 39xx;                      // claim it in TEST_PORTS first; port-registry holds this literal
const BASE = `http://127.0.0.1:${PORT}`;
const { tmp, ok, boot, crashed, done } = smoke('<name>.smoke');
const DB_PATH = join(tmp, 'test.db');

try {
  // NO JKOS_AUTH_* env → weave injects the dev-stub user { sub:1, role:'admin' }.
  await boot({ cwd: BACKEND, port: PORT, service: '<app id>', env: { DB_PATH } });
  // …assert with fetch() and ok(cond, msg)…
} catch (e) { crashed(e); } finally { done(); }   // exits 1 on a failure, a crash, or no assertions
```

Non-negotiables:
- **Throwaway port + temp DB**, cleaned in a `finally`. Never touch a real DB or a fixed shared port.
- **Real HTTP**, not in-process handler calls — the middleware stack (auth, cors, write-gate) is
  part of the contract.
- **Dev-stub auth**: leave `JKOS_AUTH_PUBLIC_KEY`/`JKOS_AUTH_JWKS_URI` unset → `sub:1, role:'admin'`.
  The write-gate lets an admin through with no `scope` claim, so writes work. Need a service/guest
  identity or a real signed token? `forgeTokens()` from the same module gives a keypair and
  `mkToken(claims)`; pass its `publicKey` as `JKOS_AUTH_PUBLIC_KEY` (see [items.smoke.mjs](../../../apps/beigeboard/backend/test/items.smoke.mjs)).
- **Event-loop trap**: if your test runs an in-process fake HTTP server (a stub Ollama/peer) AND
  drives a child that calls it, spawn the child **async** (`spawn` + await close), never `spawnSync`
  — a sync child blocks the loop so the in-process server can't answer, and you deadlock. (This is
  exactly what worker-e2e.smoke.mjs documents.)

## 3 · House pattern — transpile a pure TS module

Node has no TS runner here, so transpile the module in-memory with the repo's own `typescript`
dep and import the emitted JS — driving the REAL function. **Use
[test/lib/unit.mjs](../../../test/lib/unit.mjs); don't copy a preamble** (fifteen copies had drifted
in compile target before it existed):

```js
import { unit } from '../test/lib/unit.mjs';          // path relative to your test
const { check, deepEq, importTs, done } = unit('my-thing');   // { root } for a package-relative path
const m = await importTs('packages/x/src/thing.ts', 'thing.mjs');
check(m.f(1) === 2, 'f(1) is 2');
done();                                                // exits 1 if anything failed
```

Exemplar: [test/cards-logic.mjs](../../../test/cards-logic.mjs). For a small dependency graph (a
module that imports a couple of siblings + one or two external packages), pass `importTs`/`emitTs`
a rewrite map, as [apps/ordeck/scripts/check-hud-doc.mjs](../../../apps/ordeck/scripts/check-hud-doc.mjs)
does (rewrite each import specifier to a temp-dir sibling or stub, stub only the non-pure leaves). No new dep, no
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

A test that no script runs, runs never. The gate ([test/gate.mjs](../../../test/gate.mjs)) derives
its steps, so the hook is a script NAME, never an edit to a list:

- **Backend smoke / package test** → add it to that package's `test` script
  (`apps/<app>/backend/package.json`, `packages/<pkg>/package.json`). Every workspace package's
  `test` and `test:*` scripts are in the gate by construction.
- **Root gate scan / unit test** → add a `check:<x>` (or `test:<x>`) script to the **root**
  [package.json](../../../package.json). Every root `check:*` and `test:*` is in the gate, in
  package.json order; keep `check:build` last. Then give it a row in TESTING.md's gate table
  (`check:docs` fails until you do).
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
- [ ] Reachable from the gate: a package `test` script, a root `check:*`, or a probe (`node test/gate.mjs --list` shows it).
- [ ] `pnpm test:contracts` green, and the new test's ✓ lines show in the output.
- [ ] If it pairs a fix, the test FAILED before the fix (write it first).
