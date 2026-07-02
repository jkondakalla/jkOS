/**
 * For every app present in BOTH the registry seed and SUITE_APPS, the integration
 * fields (api_base, health_path, capabilities_path, datasets_path) must be byte-equal
 * — they are the same fact seen through two derived views. Any mismatch is 'drift':
 * post-A2 both views come from @jkos/suite-manifest builders, so a mismatch means a
 * builder maps a field differently (a real bug), not a hand-sync slip. Equality is
 * an 'ok' — it is guaranteed by construction, and this scan proves it stays so.
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
        level: 'ok',
        msg: `${dup} integration field values agree between the registry seed and SUITE_APPS — both views derive from @jkos/suite-manifest, so equality is by construction (a mismatch here means a builder mapping bug, reported as drift above)`,
        where: ['apps/jkauth/src/db.js', 'packages/weave/src/manifest.ts'],
      });
    }
    return out;
  },
};
