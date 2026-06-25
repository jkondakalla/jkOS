/**
 * THE central finding (mostly closed by ToDo A1/A2). An app's edge slug — the token in
 * /api/<slug>, /health/<slug>, and the <slug>.<resource> invalidation key — should be
 * its canonical id. Post-A2 every slug DERIVES from the id in @jkos/suite-manifest, so
 * BeigeBoard is now `beigeboard` everywhere; SylibOS is the lone holdout (edge slug
 * `sylib` ≠ id `sylibos`), pinned because it's off-limits until migrated. This probe:
 *   (a) reports every app whose slug != id (now only the un-migrated SylibOS), and
 *   (b) fails ('drift') if the slug DISAGREES across the registry, the manifest, and the
 *       nginx peer — impossible now that all three derive from one source, but the guard
 *       stays for the day a hand override reintroduces a split.
 */
import { pathSlug } from '../topology.mjs';

export default {
  id: 'slug-vs-id',
  title: 'Edge slug vs canonical app id (and slug agreement across sources)',
  run(model) {
    const out = [];
    for (const app of model.apps.values()) {
      // collect the slug each source uses for this app
      const seen = {};
      if (app.registry) seen['registry api_base'] = pathSlug(app.registry.apiBase) || pathSlug(app.registry.healthPath);
      if (app.manifest) seen['manifest apiBase'] = pathSlug(app.manifest.apiBase) || pathSlug(app.manifest.healthPath);
      if (app.nginxPeer) seen['nginx peer'] = app.nginxPeer.slug;
      if (app.docs?.invalidateKeys?.length) {
        seen['invalidation key'] = [...new Set(app.docs.invalidateKeys.map((k) => k.split('.')[0]))].join(',');
      }
      const slugs = Object.values(seen).filter(Boolean);
      const uniq = [...new Set(slugs)];
      if (uniq.length === 0) continue;

      if (uniq.length > 1) {
        out.push({
          level: 'drift',
          msg: `'${app.id}' edge slug DISAGREES across sources: ${Object.entries(seen)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}='${v}'`)
            .join(', ')}`,
        });
      } else if (uniq[0] !== app.id) {
        const where = [];
        if (app.registry) where.push('apps/jkauth/src/db.js');
        if (app.manifest) where.push('packages/weave/src/manifest.ts');
        if (app.nginxPeer) where.push('infra/nginx/gen-nginx-weave.mjs');
        if (app.docs) where.push(app.docs.file);
        out.push({
          level: 'consolidate',
          msg: `'${app.id}' is reached by the slug '${uniq[0]}' (≠ id), re-typed identically in ${where.length} sources with nothing deriving it from the id`,
          where,
        });
      } else {
        out.push({ level: 'ok', msg: `'${app.id}' slug == id, consistently '${app.id}'` });
      }
    }
    return out;
  },
};
