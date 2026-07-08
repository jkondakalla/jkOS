/**
 * LIVE-ONLY probe (runs only under `prove --live`; a no-op in file mode).
 *
 * `/auth/require-admin` is the nginx `auth_request` target every gated route delegates
 * to. Hit with NO credentials it MUST refuse (401) — that refusal is what makes the whole
 * staging origin (including /deploy, the recovery tool) admin-only. A 200 here means the
 * gate is inert or bypassed: the deployment is open to the world while the config in git
 * looks locked. That is the single highest-value live invariant, so an unauthenticated
 * 200/2xx is `drift`. A redirect or a 5xx from the gate is also flagged — the gate is not
 * cleanly refusing.
 */
export default {
  id: 'live-gate',
  title: 'Live edge — the admin gate refuses an unauthenticated request',
  run(model) {
    if (!model.live) return [];
    const g = model.live.gateUnauth;
    const where = [`${model.live.baseUrl}/auth/require-admin  (no credentials)`];

    if (!g || g.status === 0) {
      return [{ level: 'drift', msg: `admin gate unreachable (${g?.error || 'no response'}) — cannot confirm the deployment is protected`, where }];
    }
    if (g.status === 401) {
      return [{ level: 'ok', msg: `admin gate returns 401 to an unauthenticated request — the auth_request gate is live`, where }];
    }
    if (g.status === 403) {
      // A resolvable-but-not-admin identity leaked in unauthenticated: gate runs but is lax.
      return [{ level: 'drift', msg: `admin gate returns 403 (not 401) to a credential-less request — an identity was resolved without auth`, where }];
    }
    if (g.status >= 200 && g.status < 300) {
      return [{ level: 'drift', msg: `admin gate returns ${g.status} to an UNAUTHENTICATED request — the gate is inert / bypassed; the deployment is open`, where }];
    }
    if (g.status >= 300 && g.status < 400) {
      return [{ level: 'drift', msg: `admin gate returns a ${g.status} redirect instead of a clean 401 — auth_request cannot follow redirects; the gate will misbehave`, where }];
    }
    return [{ level: 'drift', msg: `admin gate returns ${g.status} to a credential-less request — expected 401`, where }];
  },
};
