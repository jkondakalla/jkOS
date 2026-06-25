/**
 * Capability scopes namespace on the CANONICAL id ('beigeboard:write'). Post-A1/A2 the
 * proxy path, health path, and invalidation key derive from that same id, so scope and
 * edge identity now coincide for a canonicalized app (BeigeBoard) — this probe reports
 * `ok`. It still flags the split for any app whose edge slug ≠ id (only the un-migrated
 * SylibOS today): there, scope namespaces on the id while the edge/bus use the slug, so
 * a new author would have to get two identifiers right.
 */
export default {
  id: 'scope-identifier',
  title: 'Which identifier do capability scopes use — id or slug?',
  run(model) {
    const out = [];
    for (const app of model.apps.values()) {
      const scopes = app.docs?.scopes || [];
      if (!scopes.length) continue;
      const namespaces = [...new Set(scopes.map((s) => s.split(':')[0]))];
      const slug = app.nginxPeer?.slug || app.slugs?.reg || null;
      for (const ns of namespaces) {
        if (ns === app.id && slug && slug !== app.id) {
          out.push({
            level: 'consolidate',
            msg: `'${app.id}' scopes namespace on the id ('${ns}:…') while its edge/bus identity is the slug '${slug}' — two identifiers for one app, chosen per concern`,
            where: [app.docs.file],
          });
        } else if (ns === app.id) {
          out.push({ level: 'ok', msg: `'${app.id}' scopes namespace on the id ('${ns}:…'), consistent with its slug`, where: [app.docs.file] });
        } else {
          out.push({
            level: 'drift',
            msg: `'${app.id}' scopes namespace on '${ns}', which is neither its id nor a known slug`,
            where: [app.docs.file],
          });
        }
      }
    }
    return out;
  },
};
