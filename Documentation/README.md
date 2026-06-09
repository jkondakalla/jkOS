# jkOS Documentation

Agent-oriented reference for the jkOS monorepo. Three files, read in this order:

| File | Read it for |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mental model: monorepo layout, `@jkos/*` package map, auth flow, theme flow, build system, runtime topology, invariants. **Start here.** |
| [SERVICES.md](SERVICES.md) | Per-service detail: dirs, packages, containers, ports, key files, routes. |
| [OPERATIONS.md](OPERATIONS.md) | Build/dev commands, Docker build model, compose/ports, deploy, staging, TrueNAS paths, verification checklist. |

## TL;DR for agents

- One pnpm + Turbo **monorepo**. `apps/*` = deployable units, `packages/@jkos/*` = shared
  libraries, `plugins/*`/`services/*` = experimental/aux.
- **Hub** = ORDECK + jkAuth + BeigeBoard + LazurOS. **Pluggable apps** = SylibOS (+future),
  which integrate by depending on the `@jkos/*` contract.
- **Never duplicate** auth/theme/preferences logic — import `@jkos/auth-client` (frontend)
  or `@jkos/auth-middleware` (backend). Theme is controlled from jkAuth and applied
  suite-wide via `@jkos/design`.
- **JS Docker images build from the repo root context.** Per-app contexts break `@jkos/*`.
- Verify changes with `pnpm build` + per-app `tsc`; Docker build is the deploy-time gate.
