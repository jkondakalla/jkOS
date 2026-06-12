# Environments — how staging and prod stay separated on one codebase

The whole suite is a single codebase deployed twice: **production** (`jkos.net`
+ subdomains) and **staging** (`staging.jkos.net`, path-routed). The source is
identical between them. The concern this doc answers:

> Fixing auth tokens on staging must not be able to break them on prod.

## The mechanism: config lives in env, not code

Every value that legitimately differs between environments is read from an
environment variable **with a production-safe default baked into the code**.
Staging's values are set **only** in the `*.staging.yml` compose files. Prod runs
the plain `docker-compose.yml` files, which carry *no* overrides, so prod always
falls back to the code default.

This is the guarantee, stated precisely:

- **Code defaults are prod values.** `JKOS_COOKIE_SUFFIX` defaults to `''`,
  `JKOS_AUTH_ISSUER` to `jkos-auth`, `COOKIE_DOMAIN` to `.jkos.net`, auth URL to
  `https://auth.jkos.net`. A service started with no env is a prod service.
- **Staging overrides live only in `docker-compose.staging.yml`.** Production
  deploys never load those files (`jkos-deploy` runs `docker-compose.yml` for
  prod, `docker-compose.staging.yml` for staging).
- **Therefore a merge is safe by construction.** Merging `staging → main` carries
  both compose files, but production only ever *reads* the prod compose. There is
  no code path where a staging-only value reaches a prod container. Nothing has to
  "adjust on merge" because the environment-specific config is never in the code
  that gets merged — it is in the deploy target's env.

If you ever see prod behaving like staging, the cause can only be that a staging
value was wrongly written into a prod `docker-compose.yml` (not a `*.staging.yml`)
— a one-line, reviewable diff, never a silent code merge.

## The environment contract

These are the only knobs that differ. Add new ones here when introduced.

| Variable                          | Production (default)        | Staging                          | Owned by                         |
|-----------------------------------|-----------------------------|----------------------------------|----------------------------------|
| `JKOS_COOKIE_SUFFIX`              | `` (→ `jkos_token`)         | `_staging` (→ `jkos_token_staging`) | jkAuth, auth-middleware, jkos-deploy |
| `JKOS_AUTH_ISSUER`               | `jkos-auth`                 | `jkos-auth-staging`              | jkAuth (sign), all verifiers     |
| `COOKIE_DOMAIN`                  | `.jkos.net`                 | `staging.jkos.net`              | jkAuth                           |
| `JKOS_AUTH_URL` / `VITE_JKOS_AUTH_URL` | `https://auth.jkos.net` | `https://staging.jkos.net`  | app frontends/backends           |
| `VITE_BASE`                      | `/`                         | `/sylib/`, `/beigeboard/`       | app frontend builds              |
| `PROD_BRANCH` (deploy only)      | `main`                      | `staging` (promote-from-staging) | jkos-deploy                      |

### Why these specific auth values matter

The prod cookie is set on `.jkos.net`, so the browser sends it to
`staging.jkos.net` as well. If staging reused the same cookie **name**, the two
collide and the server reads whichever the browser sends first — so staging would
silently run on the prod session. Isolation therefore requires **all** of:

1. **Distinct cookie name** (`_staging` suffix) — staging never reads the prod
   cookie and vice-versa.
2. **Distinct issuer** (`jkos-auth-staging`) — even if a token crossed over, the
   verifier rejects the wrong issuer.
3. **Distinct gate** — the staging nginx `auth_request` verifies against
   `staging-jkos-auth`, and unauthenticated users are sent to staging's own login
   portal, which mints a host-scoped staging cookie.

## Residual hardening (not yet done)

Staging and prod currently **share the RSA signing keypair** (loaded from the
same `apps/jkauth/.env`). Logical isolation above means a prod token can't be used
on staging or vice-versa, but a compromise of the staging auth *process* could
mint prod-valid tokens. The gold-standard next step is a **separate staging
keypair**: generate a staging RSA key, put the private half in a staging-only env
and the public half in the staging verifiers, leaving prod untouched. This should
be done with a verified rebuild (so a bad key never reaches a running service) —
tracked as a follow-up.
