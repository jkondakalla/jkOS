/**
 * For every app present in BOTH the registry seed and SUITE_APPS, the integration
 * fields (api_base, health_path, capabilities_path, datasets_path) must be byte-equal
 * — they are the same fact written twice. Any mismatch is 'drift' (a real, shipping
 * inconsistency between the authoritative source and its fallback). Equality is still
 * a 'consolidate' note, because equal-by-hand is one careless edit from drift.
 */
const FIELDS = [
  ['apiBase', 'api_base'],
  ['healthPath', 'health_path'],
  ['capabilitiesPath', 'capabilities_path'],
  ['datasetsPath', 'datasets_path'],
];

export default {
  id: 'registry-manifest-fields',
  title: 'Registry vs manifest — integration field equality',
  run(model) {
    const out = [];
    let dup = 0;
    for (const app of model.apps.values()) {
      if (!(app.inRegistry && app.inManifest)) continue;
      for (const [mKey, rKey] of FIELDS) {
        const m = app.manifest[mKey] ?? null;
        const r = app.registry[mKey] ?? null; // registry rows were normalized to camel
        const norm = (v) => (v == null ? null : v);
        if (norm(m) !== norm(r)) {
          out.push({
            level: 'drift',
            msg: `'${app.id}'.${rKey} differs: registry='${r}' vs manifest='${m}'`,
            where: ['apps/jkauth/src/db.js', 'packages/weave/src/manifest.ts'],
          });
        } else if (norm(m) != null) {
          dup++;
        }
      }
    }
    if (dup) {
      out.push({
        level: 'consolidate',
        msg: `${dup} integration field values are duplicated verbatim between the registry seed and SUITE_APPS — equal today, unenforced tomorrow`,
        where: ['apps/jkauth/src/db.js', 'packages/weave/src/manifest.ts'],
      });
    }
    return out;
  },
};
