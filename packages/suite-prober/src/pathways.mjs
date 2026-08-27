/**
 * pathways.mjs — THE EXPANDABLE PATHWAY CATALOG (data).
 *
 * This is the "sixth app" expressed as data: every pathway it would touch across the
 * five systems, one row each. A row records which shared helper the pathway is meant
 * to go through (the architecture rule "never hand-roll, import @jkos/*") and, where
 * a pathway has a known architectural gap, a `gap` note. Probes read this catalog;
 * adding an endpoint = adding a row, no probe edits.
 *
 * `helper: null` legitimately means "no shared helper applies" (a page route, an SSE
 * stream). A backend data/auth pathway with `helper: null` is itself suspicious and
 * the pathway-helpers probe surfaces it.
 */

export const SYSTEMS = ['jkauth', 'beigeboard', 'weave', 'ordeck', 'jkdeploy'];

export const PATHWAYS = [
  // ── jkAuth ──────────────────────────────────────────────────────────────────
  { system: 'jkauth', id: 'login', method: 'POST', path: '/auth/login', helper: null, kind: 'page-auth' },
  { system: 'jkauth', id: 'login-2fa', method: 'POST', path: '/auth/login/2fa', helper: null, kind: 'page-auth' },
  { system: 'jkauth', id: 'register', method: 'POST', path: '/auth/register', helper: null, kind: 'page-auth' },
  { system: 'jkauth', id: 'guest', method: 'POST', path: '/auth/guest', helper: null, kind: 'page-auth' },
  { system: 'jkauth', id: 'refresh', method: 'POST', path: '/auth/refresh', helper: null, kind: 'token',
    note: 'rotating refresh + 10s grace window for concurrent tabs' },
  { system: 'jkauth', id: 'logout', method: 'POST', path: '/auth/logout', helper: null, kind: 'token' },
  { system: 'jkauth', id: 'service-token', method: 'POST', path: '/auth/token', helper: null, kind: 'token',
    gap: 'disabled unless JKOS_SERVICE_CLIENTS is set; no contract test asserts the env is present for a new service client' },
  { system: 'jkauth', id: 'me', method: 'GET', path: '/auth/me', helper: 'authFetch', kind: 'identity' },
  { system: 'jkauth', id: 'profile-get', method: 'GET', path: '/auth/profile', helper: 'useJkOSPreferences', kind: 'prefs' },
  // The old gap here ('last-write-wins, no optimistic lock') was FIXED by ARCH-7.2/G8
  // and went stale in this catalogue — the prose is hand-written and nothing re-checks it
  // against the route, so it kept reporting a solved problem (corrected 2026-07-30).
  // What's live now: preferences DEEP-merge (so two tabs on different slices can't clobber),
  // and `prefs_version` is a real optimistic lock returning 409 CONFLICT — asserted in
  // apps/jkauth/test/multiuser.mjs. The residual, genuine gap is that the lock is OPT-IN.
  { system: 'jkauth', id: 'profile-patch', method: 'PATCH', path: '/auth/profile', helper: 'patchProfile', kind: 'prefs',
    gap: 'the prefs_version optimistic lock is OPT-IN: a client that omits it still writes (deep-merged, so it cannot drop a sibling slice, but it cannot detect a concurrent edit either)' },
  { system: 'jkauth', id: 'apps', method: 'GET', path: '/auth/apps', helper: 'useSuiteApps', kind: 'directory' },
  { system: 'jkauth', id: 'events', method: 'GET', path: '/auth/events', helper: 'authFetch', kind: 'directory' },
  { system: 'jkauth', id: 'jwks', method: 'GET', path: '/auth/jwks', helper: 'weaveAuth', kind: 'key' },
  // ⚠️ This carried a `gap:` saying the staging auth_request targets PROD jkAuth,
  // so a prod outage would take staging — including /deploy, the recovery tool —
  // down with it. Not true: standalone.conf's /_auth_admin_check sets
  // $auth_upstream to `staging-jkos-auth:3100`, and the isolation comes from the
  // cookie name and the issuer instead (staging reads jkos_token_staging and
  // verifies jkos-auth-staging, so a prod session grants nothing there).
  // Documentation/ARCHITECTURE.md asserted the same wrong thing and was corrected
  // in the same pass — two sources agreeing with each other and not with the
  // config is exactly how prose outlives the thing it describes.
  { system: 'jkauth', id: 'require-admin', method: 'GET', path: '/auth/require-admin', helper: null, kind: 'gate' },
  { system: 'jkauth', id: 'widgets-get', method: 'GET', path: '/auth/widgets', helper: 'authFetch', kind: 'widgets' },
  // ⚠️ This carried a `gap:` saying "no role-scope on a widget, so a write/admin
  // widget shows to guests who then hit READ_ONLY/FORBIDDEN" — CLOSED by jkAuth
  // migration 016, which added widget_registry.allowed_roles, and by roleMaySee()
  // in routes/weave.js which intersects it with the caller's role at GET
  // /auth/widgets. Removed 2026-08-27 after re-reading both. A prober gap string
  // is unverified PROSE: nothing re-checks it, so it outlives its defect and
  // trains people to skim the gap list. Re-read one before you trust it, and
  // delete it the moment it stops being true.
  { system: 'jkauth', id: 'widgets-post', method: 'POST', path: '/auth/widgets', helper: 'authFetch', kind: 'widgets' },
  { system: 'jkauth', id: 'widgets-delete', method: 'DELETE', path: '/auth/widgets/:id', helper: 'authFetch', kind: 'widgets' },

  // ── BeigeBoard ──────────────────────────────────────────────────────────────
  { system: 'beigeboard', id: 'health', method: 'GET', path: '/health', helper: 'healthHandler', kind: 'weave' },
  { system: 'beigeboard', id: 'capabilities', method: 'GET', path: '/api/capabilities', helper: 'serveCapabilities', kind: 'weave' },
  { system: 'beigeboard', id: 'datasets', method: 'GET', path: '/api/datasets', helper: 'serveDatasets', kind: 'weave' },
  { system: 'beigeboard', id: 'items-get', method: 'GET', path: '/api/items', helper: 'buildItemFilters', kind: 'data' },
  { system: 'beigeboard', id: 'items-post', method: 'POST', path: '/api/items', helper: 'weaveWriteGate', kind: 'data' },
  { system: 'beigeboard', id: 'items-patch', method: 'PATCH', path: '/api/items/:id', helper: 'weaveWriteGate', kind: 'data' },
  { system: 'beigeboard', id: 'items-delete', method: 'DELETE', path: '/api/items/:id', helper: 'weaveWriteGate', kind: 'data' },
  { system: 'beigeboard', id: 'import', method: 'POST', path: '/api/import', helper: 'weaveWriteGate', kind: 'data',
    note: 'one-pass validate then single transaction; ?dryRun=1 previews' },
  { system: 'beigeboard', id: 'cal-google', method: 'GET', path: '/api/auth/google', helper: null, kind: 'oauth' },
  { system: 'beigeboard', id: 'cal-google-sync', method: 'POST', path: '/api/calendar/google/sync', helper: null, kind: 'oauth' },
  { system: 'beigeboard', id: 'cal-outlook-sync', method: 'POST', path: '/api/calendar/outlook/sync', helper: null, kind: 'oauth' },
  { system: 'beigeboard', id: 'cal-icloud-sync', method: 'POST', path: '/api/calendar/icloud/sync', helper: null, kind: 'oauth' },
  { system: 'beigeboard', id: 'ai-parse-task', method: 'POST', path: '/api/ai/parse-task', helper: 'weaveWriteGate', kind: 'ai',
    note: 'declared as the parseTask capability — discoverable + invokable through Weave (G2 closed)' },
  { system: 'beigeboard', id: 'ai-breakdown', method: 'POST', path: '/api/ai/breakdown', helper: 'weaveWriteGate', kind: 'ai',
    note: 'declared as the breakdownGoal capability — discoverable through Weave (G2 closed)' },

  // ── Weave (the fabric the sixth app rides) ────────────────────────────────────
  { system: 'weave', id: 'discover-apps', method: 'fn', path: 'useSuiteApps()', helper: 'useSuiteApps', kind: 'discovery' },
  { system: 'weave', id: 'list', method: 'fn', path: "weaveClient(app).list()", helper: 'weaveClient', kind: 'read' },
  { system: 'weave', id: 'useWeaveList', method: 'fn', path: 'useWeaveList(app, ds, filters)', helper: 'useWeaveList', kind: 'read' },
  { system: 'weave', id: 'command', method: 'fn', path: "weaveClient(app).command()", helper: 'runCommand', kind: 'write' },
  { system: 'weave', id: 'server-client', method: 'fn', path: 'weaveServerClient(app, { actingUser })', helper: 'weaveServerClient', kind: 'write' },
  { system: 'weave', id: 'docshape', method: 'fn', path: 'checkDocShape()', helper: 'checkDocShape', kind: 'contract' },

  // ── ORDECK ────────────────────────────────────────────────────────────────────
  { system: 'ordeck', id: 'launcher', method: 'GET', path: '/auth/apps', helper: 'useSuiteApps', kind: 'discovery' },
  { system: 'ordeck', id: 'workshop', method: 'page', path: '/widgets', helper: null, kind: 'admin' },
  { system: 'ordeck', id: 'hud-read', method: 'spec', path: 'list-node → dataset', helper: 'useWeaveList', kind: 'read' },
  { system: 'ordeck', id: 'hud-write', method: 'spec', path: 'form+button → capability', helper: 'runCommand', kind: 'write' },
  { system: 'ordeck', id: 'layout', method: 'PATCH', path: '/auth/profile (prefs)', helper: 'useHudShelf', kind: 'prefs' },
  { system: 'ordeck', id: 'theme', method: 'fn', path: 'applyJkOSTheme/applyJkOSMode', helper: 'applyTheme', kind: 'prefs' },

  // ── jkDeploy ────────────────────────────────────────────────────────────────
  { system: 'jkdeploy', id: 'ui', method: 'GET', path: '/', helper: 'jkos_auth.py', kind: 'page-auth' },
  { system: 'jkdeploy', id: 'health', method: 'GET', path: '/health', helper: null, kind: 'ops' },
  { system: 'jkdeploy', id: 'info', method: 'GET', path: '/info', helper: null, kind: 'ops' },
  { system: 'jkdeploy', id: 'logs-stream', method: 'GET', path: '/logs/stream', helper: null, kind: 'ops' },
  { system: 'jkdeploy', id: 'staging-sync', method: 'POST', path: '/staging/sync', helper: 'lib-deploy.sh', kind: 'deploy' },
  { system: 'jkdeploy', id: 'prod-deploy', method: 'POST', path: '/prod/deploy', helper: 'lib-deploy.sh', kind: 'deploy',
    gap: 'prod deploy runs MANAGE_NGINX=0, so a new peer\'s regenerated weave-proxy.conf blocks are inert until nginx is manually restarted' },
];
