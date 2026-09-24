'use strict'
// suite-manifest/scopes.js — what jkAuth may GRANT, derived from what capability docs
// DECLARE. Reached as `@jkos/suite-manifest/scopes`.
//
// ⚠️ A SEPARATE ENTRY, NOT A SECTION OF apps.js, AND THAT IS LOAD-BEARING. apps.js is
// bundled into every SPA (Weave's manifest.ts imports it through CJS interop), and the
// first cut of this lived there and required ./scopes.generated.js — which broke
// PapyrOS's and KourOS's production builds: an injected workspace copy does not carry a
// newly added file until `pnpm install` re-syncs it (TRAPS.md), and `check:build` went
// red. The grant is jkAuth's concern alone, so it has its own entry and apps.js keeps
// requiring nothing.
//
// Zero deps, CJS, no build step, safe in a bare checkout — same rules as apps.js.

const { APPS, scopeFor } = require('./apps.js')
/** The scopes each app's capability doc DECLARES — generated, never hand-edited
 *  (scripts/gen-scopes.mjs, held fresh by `pnpm check:scopes`). */
const DECLARED_SCOPES = require('./scopes.generated.js')

/** The verbs the shared write gate maps HTTP methods onto (weave writeGate.js). A
 *  declared `<app>:write` is the superset of these, so declaring it makes each of them
 *  grantable on its own — which is what lets a service client hold `beigeboard:create`
 *  and nothing wider. */
const WRITE_LADDER = Object.freeze(['create', 'update', 'delete'])

/** Suite-level scopes that belong to no one app. */
const SUITE_SCOPES = Object.freeze(['suite:admin'])

/**
 * What jkAuth may GRANT for one app, derived from what its capability doc declares.
 *
 * ⚠️ Before this, jkAuth minted `<app>:read|write|create|update|delete|admin` for EVERY
 * registry app it could reach — `ordeck:delete`, `auth:admin`, `lazuros:admin` — scopes
 * no capability declares and no route checks. A grant nothing declares is not harmless:
 * it is authority waiting for the first route that trusts the name. Now:
 *   · `<id>:read` always — reads are role-gated by the registry, not declared per door;
 *   · a declared scope, and — for a declared `<id>:write` — the create/update/delete
 *     ladder beneath it;
 *   · nothing else. An app that declares no writes grants no write scope.
 */
function grantableScopes(id) {
  const out = [scopeFor(id, 'read')]
  const add = (s) => { if (!out.includes(s)) out.push(s) }
  for (const s of DECLARED_SCOPES[id] || []) {
    add(s)
    if (s === scopeFor(id, 'write')) for (const v of WRITE_LADDER) add(scopeFor(id, v))
  }
  return out
}

/** True iff SOME token could legitimately carry `scope`: an app scope grantable for a
 *  registry app, or a suite-level scope. jkAuth refuses to boot on a service client
 *  configured with anything else. */
function isGrantableScope(scope) {
  if (SUITE_SCOPES.includes(scope)) return true
  const id = String(scope).split(':')[0]
  const app = APPS.find((a) => a.id === id)
  return !!app && app.registry !== false && grantableScopes(id).includes(scope)
}

module.exports = {
  DECLARED_SCOPES,
  WRITE_LADDER,
  SUITE_SCOPES,
  grantableScopes,
  isGrantableScope,
}
