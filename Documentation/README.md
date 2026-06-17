# jkOS Documentation

Agent-oriented reference for the jkOS monorepo.

| File | Read it for |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Monorepo layout, shared packages, auth/theme flows, build system, runtime topology, env isolation. **Start here.** |
| [SERVICES.md](SERVICES.md) | Per-service detail: dirs, containers, ports, key files, routes. |
| [OPERATIONS.md](OPERATIONS.md) | Dev commands, Docker build, deploy, cold start, TrueNAS paths, gotchas. |
| [DESIGN.md](DESIGN.md) | Design system: aesthetic, token contract, factory, typography, component classes, per-app constraints. |

**TL;DR for agents**

- One pnpm + Turbo monorepo. `apps/*` = deployable units, `packages/@jkos/*` = shared libraries.
- **Hub** = ORDECK + jkAuth + BeigeBoard + LazurOS. **Pluggable** = SylibOS (+ future).
- Never duplicate auth/theme/preferences logic — import `@jkos/auth-client` (frontend) or `@jkos/auth-middleware` (backend).
- JS Docker images build from the **repo root context**. Per-app contexts break `@jkos/*` visibility.
- Verify with `pnpm build` + per-app `tsc`; Docker build from root is the deploy-time gate.
