/**
 * The invalidation bus key ('<slug>.<resource>', e.g. 'beigeboard.items') used to be
 * declared THREE times that had to agree for a HUD widget to refresh after a write:
 * on the capability (writer side), on the dataset (reader side), and hand-passed by
 * every widget into useWeaveList's invalidateOn. The triple is now COLLAPSED to the
 * one derivation `resourceKey(app, dataset)`: capabilities declare it, and
 * useWeaveList derives its default subscription from its own (app, dataset) args —
 * no caller-typed literal. What this probe still guards: every DECLARED key must
 * match the derivation (prefix = the app's edge slug, suffix = a declared dataset
 * id); a stray literal ('beigeboard.task' vs dataset 'items') would sever writer
 * from reader silently, so it reports as drift here.
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
      // The reader side derives resourceKey(app, dataset), so a declared key whose
      // suffix is not a declared dataset id will never be subscribed by default.
      const dsIds = (app.docs?.datasets || []).map((d) => d.id);
      if (dsIds.length) {
        const strays = keys.filter((k) => !dsIds.includes(k.split('.').slice(1).join('.')));
        if (strays.length) {
          out.push({
            level: 'drift',
            msg: `'${app.id}' declares invalidation key(s) ${strays.join(', ')} whose suffix is no declared dataset id (${dsIds.join(', ')}) — useWeaveList's derived subscription will never hear them`,
            where: [app.docs.file, 'packages/weave/src/weaveClient.ts'],
          });
        } else {
          out.push({
            level: 'ok',
            msg: `'${app.id}' invalidation keys all match resourceKey(app, dataset) for a declared dataset — writer declares the derived key, useWeaveList derives the same subscription, widgets pass no literal`,
            where: [app.docs.file, 'packages/weave/src/weaveClient.ts'],
          });
        }
      }
    }
    return out;
  },
};
