/**
 * Two "app lists" exist — the authoritative jkAuth app_registry seed and the Weave
 * SUITE_APPS static manifest. The manifest claims to be only the offline fallback,
 * yet it is a hand-maintained second copy of the same rows. This probe reports where
 * the two disagree on MEMBERSHIP (an app in one list but not the other), which is the
 * cheapest possible proof that the duplicate can and already does drift.
 */
export default {
  id: 'app-list-parity',
  title: 'Registry seed vs SUITE_APPS manifest — membership',
  run(model) {
    const out = [];
    const regFile = 'apps/jkauth/src/db.js';
    const manFile = 'packages/weave/src/manifest.ts';
    for (const app of model.apps.values()) {
      if (app.inRegistry && app.inManifest) {
        out.push({ level: 'ok', msg: `'${app.id}' is declared in both lists` });
      } else if (app.inRegistry) {
        out.push({
          level: 'info',
          msg: `'${app.id}' is in the registry seed but NOT in SUITE_APPS`,
          where: [regFile],
        });
      } else {
        out.push({
          level: 'info',
          msg: `'${app.id}' is in SUITE_APPS but NOT in the registry seed`,
          where: [manFile],
        });
      }
    }
    out.push({
      level: 'consolidate',
      msg: `Two app lists exist (${model.registry.length} registry rows, ${model.manifest.length} manifest entries) carrying the same api_base/health_path/capabilities_path/datasets_path fields — one is hand-kept duplicate of the other`,
      where: [regFile, manFile],
    });
    return out;
  },
};
