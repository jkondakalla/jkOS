# jkOS Documentation

Agent-oriented reference for the jkOS monorepo. Four files, read in this order:

| File | Read it for |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mental model: monorepo layout, `@jkos/*` package map, auth flow, theme flow, build system, runtime topology, invariants. **Start here.** |
| [SERVICES.md](SERVICES.md) | Per-service detail: dirs, packages, containers, ports, key files, routes. |
| [OPERATIONS.md](OPERATIONS.md) | Build/dev commands, Docker build model, compose/ports, deploy, staging, TrueNAS paths, verification checklist. |
| [DESIGN.md](DESIGN.md) | Design system: kraft-paper/CRT aesthetic, `--hub-*` token contract, mode/theme appliers, per-app styling stacks, shared hardware-chrome classes, design-pass invariants. |
| [STARTUP.md](STARTUP.md) | Cold-start guide: DNS, certs, data dirs, keypair generation, `.env` setup, startup order, verification, re-deploy, troubleshooting. |
| [ENVIRONMENTS.md](ENVIRONMENTS.md) | How staging and prod stay isolated on one codebase: the env-driven config contract, why merges are safe, the auth-isolation rules. |
| [SKILLS.md](SKILLS.md) | High-level, portfolio-facing map of the marketable engineering skills the suite demonstrates, each anchored to real work. |

## App-level and supplementary docs

| File | Covers |
|------|--------|
| [apps/sylibos/README.md](../apps/sylibos/README.md) | SylibOS dev setup, CourseProcessor CLI usage, backend API reference, environment variables. |
| [apps/beigeboard/MOBILE_INTEGRATION.md](../apps/beigeboard/MOBILE_INTEGRATION.md) | BeigeBoard mobile layout (`src/mobile/`) — component overview, integration steps, props API, theming. |
| [infra/plugin-docker/TRUENAS_SETUP.md](../infra/plugin-docker/TRUENAS_SETUP.md) | **Deprecated (2026-06-04)** — old polyrepo TrueNAS deploy guide. Superseded by OPERATIONS.md and the monorepo deploy model. Kept for historical reference only. |

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
