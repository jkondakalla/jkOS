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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathSlug, REPO_ROOT } from '../topology.mjs';

const CONF = 'infra/nginx/weave-proxy.conf';

/** How an app's peer `location <apiBase>/ { … }` block treats the prefix, read from the
 *  GENERATED conf (`check:nginx` separately proves it matches the generator, so this is
 *  the same truth the edge runs). nginx can drop the prefix two ways, and the suite uses
 *  both: a `rewrite ^<prefix>/(.*)$ … break` (the derived peer blocks), or a proxy_pass
 *  carrying its own path / trailing slash (which replaces the matched prefix). Neither →
 *  the prefix reaches the app untouched. */
function edgePrefixFor(conf, apiBase) {
  const at = conf.indexOf(`location ${apiBase}/ {`);
  if (at < 0) return null;
  const body = conf.slice(at, conf.indexOf('\n}', at));
  const pp = (body.match(/proxy_pass\s+([^;]+);/) || [])[1]?.trim();
  if (!pp) return null;
  const rewrites = /rewrite\s+\^[^;]*break\s*;/.test(body);
  const passHasPath = /^https?:\/\/[^/\s]+\/./.test(pp) || pp.endsWith('/');
  return { pp, keeps: !rewrites && !passHasPath };
}

/** Does this app's backend serve its routes at their FULL edge paths?
 *  The tell is the capability doc: BeigeBoard declares `/items` (bare — the app's own
 *  route table knows nothing of `/api/beigeboard`), while LazurOS declares
 *  `/api/lazuros/parse-task` (prefixed — its Express routes carry the edge prefix).
 *  Only apps in the second group may have the prefix preserved by nginx. */
function declaresPrefixedPaths(app, apiBase) {
  const caps = app.docs?.capabilities || [];
  if (!caps.length || !apiBase) return null; // nothing to infer from
  return caps.every((c) => typeof c.path === 'string' && c.path.startsWith(apiBase + '/'));
}

export default {
  id: 'nginx-coverage',
  title: 'Edge reachability — every advertised surface has an nginx proxy block',
  run(model) {
    const out = [];
    let conf = '';
    try { conf = readFileSync(join(REPO_ROOT, CONF), 'utf8'); } catch { /* checked below */ }

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

        // Prefix agreement: does the edge STRIP '/api/<id>' before proxying, and does the
        // app's own route table expect it stripped? A `proxy_pass` ending in '/' (or any
        // path) replaces the matched prefix; a bare host:port preserves it. Get this
        // backwards and every route 404s at the edge while passing every local test —
        // which is exactly what happened to LazurOS (its Express routes carry the full
        // /api/lazuros prefix, but the block stripped it, so nothing it advertised was
        // reachable). Neither source is wrong alone; only together are they a bug.
        const edge = conf ? edgePrefixFor(conf, apiBase) : null;
        const prefixed = declaresPrefixedPaths(app, apiBase);
        if (edge && prefixed !== null) {
          if (prefixed !== edge.keeps) {
            const [serves, does] = prefixed ? ['FULL edge', 'STRIPS'] : ['BARE', 'PRESERVES'];
            out.push({
              level: 'drift',
              msg: `'${app.id}' serves ${serves} paths (its capability doc declares '${prefixed ? apiBase + '/…' : 'paths without ' + apiBase}'), but the nginx block ${does} '${apiBase}' (proxy_pass ${edge.pp}) — every advertised path 404s at the edge`,
              where: ['infra/nginx/gen-nginx-weave.mjs', CONF, app.docs?.file].filter(Boolean),
            });
          } else {
            out.push({
              level: 'ok',
              msg: `'${app.id}' edge/route prefix agree — the app serves ${prefixed ? 'FULL' : 'BARE'} paths and nginx ${edge.keeps ? 'preserves' : 'strips'} '${apiBase}'`,
              where: [CONF, app.docs?.file].filter(Boolean),
            });
          }
        }
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
