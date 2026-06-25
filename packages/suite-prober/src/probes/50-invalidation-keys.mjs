/**
 * The invalidation bus key ('<slug>.<resource>', e.g. 'beigeboard.items') is declared
 * THREE times that must agree for a HUD widget to refresh after a write: on the
 * capability (writer side), on the dataset (reader side), and passed by the widget into
 * useWeaveList's invalidateOn. The key is now DERIVED from the app id via resourceKey
 * (ToDo A5), so the prefix can't mistype — but nothing yet enforces the three call sites
 * pass the SAME key, so a stray literal ('beigeboard.task' vs 'beigeboard.items') still
 * yields a silent stale UI. This probe confirms the prefix matches the app's edge slug
 * and flags the still-unenforced triple (the validator is ToDo B1).
 */
import { pathSlug } from '../topology.mjs';

export default {
  id: 'invalidation-keys',
  title: 'Invalidation-bus key derivation and agreement',
  run(model) {
    const out = [];
    for (const app of model.apps.values()) {
      const keys = app.docs?.invalidateKeys || [];
      if (!keys.length) continue;
      const slug = (app.registry && pathSlug(app.registry.apiBase)) || app.nginxPeer?.slug || app.id;
      const prefixes = [...new Set(keys.map((k) => k.split('.')[0]))];
      for (const p of prefixes) {
        if (p === slug) {
          out.push({ level: 'ok', msg: `'${app.id}' invalidation keys use prefix '${p}' matching its slug (${keys.join(', ')})`, where: [app.docs.file] });
        } else {
          out.push({
            level: 'drift',
            msg: `'${app.id}' invalidation key prefix '${p}' does not match its edge slug '${slug}'`,
            where: [app.docs.file],
          });
        }
      }
      out.push({
        level: 'gap',
        msg: `'${app.id}' invalidation keys (${keys.join(', ')}) are free-form strings repeated on capability + dataset + every widget's invalidateOn — no validator asserts the three agree, so a typo silently stops HUD refresh`,
        where: [app.docs.file, 'packages/weave/src/resource.ts', 'packages/weave/src/weaveClient.ts'],
      });
    }
    return out;
  },
};
