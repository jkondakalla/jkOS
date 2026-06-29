/**
 * Edge reachability: every app that ADVERTISES a backend surface must have an nginx
 * proxy block that routes it. An app's registry/manifest row can carry an `api_base`
 * ('/api/<id>') or `health_path` ('/health/<id>') — the moment it does, a browser (or
 * the HUD health poll) WILL hit that edge path, so nginx must have a matching peer
 * location pointed at a container upstream. The failure this catches: add an app with
 * `api:true`/`health:true` to @jkos/suite-manifest but forget its `upstream`, and the
 * registry/manifest will happily advertise '/api/<id>' while `peers()` emits no block
 * for it → the edge 404s an endpoint the suite swears exists. That is `drift` (the
 * registry promises an endpoint nginx cannot serve).
 *
 * Apps with NO backend surface (the ORDECK portal shell, the staging origin) are
 * primary origins served by their own `standalone.conf` server block, not a Weave
 * peer — they legitimately have no peer here and are reported `info`, never flagged.
 * Since both the surface fields and `peers()` derive from the one APPS table, a green
 * result also means the table is internally coherent; `check:nginx` separately proves
 * the GENERATED conf on disk matches that table.
 */
import { pathSlug } from '../topology.mjs';

export default {
  id: 'nginx-coverage',
  title: 'Edge reachability — every advertised surface has an nginx proxy block',
  run(model) {
    const out = [];
    for (const app of model.apps.values()) {
      // The edge paths the registry/manifest advertise for this app.
      const apiBase = app.registry?.apiBase || app.manifest?.apiBase || null;
      const healthPath = app.registry?.healthPath || app.manifest?.healthPath || null;
      const surfaces = [apiBase && `api ${apiBase}`, healthPath && `health ${healthPath}`].filter(Boolean);

      if (!surfaces.length) {
        // No api/health edge path → a primary-origin shell (portal, staging). No peer expected.
        out.push({
          level: 'info',
          msg: `'${app.id}' advertises no api/health edge path — a primary-origin shell, not a Weave peer (no proxy block expected)`,
        });
        continue;
      }

      if (app.nginxPeer) {
        out.push({
          level: 'ok',
          msg: `'${app.id}' advertises ${surfaces.join(' + ')} and has an nginx peer block → ${app.nginxPeer.upstream}`,
          where: ['infra/nginx/gen-nginx-weave.mjs', 'infra/nginx/weave-proxy.conf'],
        });
      } else {
        const slug = pathSlug(apiBase) || pathSlug(healthPath) || app.id;
        out.push({
          level: 'drift',
          msg: `'${app.id}' advertises ${surfaces.join(' + ')} but no nginx peer routes slug '${slug}' — the registry promises an endpoint the edge cannot serve (missing 'upstream' in @jkos/suite-manifest APPS?)`,
          where: ['packages/suite-manifest/apps.js', 'infra/nginx/gen-nginx-weave.mjs'],
        });
      }
    }
    return out;
  },
};
