# @jkos/suite-manifest

The **single source of truth** for the jkOS app directory. One row per app in
[`APPS`](apps.js); everything else derives from it:

| Consumer | Builder | File |
|----------|---------|------|
| jkAuth `app_registry` seed | `registrySeed()` | `apps/jkauth/src/db.js` |
| Weave `SUITE_APPS` fallback | `manifestApps()` | `packages/weave/src/manifest.ts` |
| nginx peer-proxy table | `peers()` | `infra/nginx/gen-nginx-weave.mjs` |
| suite-prober topology | all three | `packages/suite-prober` |

## The identity rule

The app **`id` is the only identifier**. Edge paths, the invalidation bus key, and
the scope namespace are all *computed* from it:

```
apiBase          = '/api/'    + id        (when `api`)
healthPath       = '/health/' + id        (when `health`)
capabilitiesPath = apiBase + '/capabilities'
datasetsPath     = apiBase + '/datasets'
resourceKey(id,r)= id + '.' + r           (invalidation bus key)
scopeFor(id,v)   = id + ':' + v           (capability scope)
```

The only stored infra fact is `upstream` (`container:port`) — nginx needs an address
the registry deliberately never stores.

## Overrides

An app whose edge slug ≠ id pins `apiBase`/`healthPath` so derivation can't rename
its paths:

- **`sylibos`** — edge slug `sylib`, un-migrated and **off-limits** (pins `apiBase`).
- **`lazuros`** — host-network AI gateway with bespoke `/api/lazuros/health`
  (`registry: false`, `kind: 'lazuros'`).

## Adding an app

Add one row to `APPS`, then re-derive the edge config and check it's in sync:

```sh
node infra/nginx/gen-nginx-weave.mjs        # regenerate weave-proxy*.conf
pnpm test:contracts                          # registry/manifest/nginx parity gate
```

Zero deps, CommonJS, no build step — safe to `require()`/`import` from a bare
checkout (no env, DB, or network).
