/**
 * LIVE-ONLY probe (runs only under `prove --live`; a no-op in file mode).
 *
 * Every registry app advertises a health path. This asserts the edge actually serves it
 * and returns the ONE weave health contract `{status:'ok', service}`. It catches the
 * "deployed but dead / nginx block inert / container down" class the file probes can't
 * see — they never touch the network. A dead or 404ing health path is `drift` (fails a
 * `--live` run); an auth-gated health path is `info` (supply a token to verify).
 */
export default {
  id: 'live-health',
  title: 'Live edge — every advertised health path answers {status:\'ok\'}',
  run(model) {
    if (!model.live) return [];
    const out = [];
    for (const [id, rec] of Object.entries(model.live.apps)) {
      const hp = model.apps.get(id)?.registry?.healthPath;
      if (!hp) continue;
      const h = rec.health;
      const where = [`${model.live.baseUrl}${hp}`];
      if (!h || h.status === 0) {
        out.push({ level: 'drift', msg: `'${id}': health unreachable (${h?.error || 'no response'}) — registry-advertised but dead at the edge`, where });
      } else if (h.status === 404 || h.status >= 500) {
        out.push({ level: 'drift', msg: `'${id}': health ${h.status} through the edge — path not served (container down / nginx block inert)`, where });
      } else if (h.status === 401 || h.status === 403) {
        out.push({ level: 'info', msg: `'${id}': health ${h.status} — gated at the edge; supply a token to verify liveness`, where });
      } else if (h.status === 200 && h.body && typeof h.body === 'object' && h.body.status === 'ok') {
        out.push({ level: 'ok', msg: `'${id}': health 200 {status:'ok'${h.body.service ? `, service:'${h.body.service}'` : ''}} through the edge`, where });
      } else {
        out.push({ level: 'drift', msg: `'${id}': health ${h.status} but body is not the {status:'ok'} weave contract (got ${JSON.stringify(h.body)?.slice(0, 80)})`, where });
      }
    }
    return out;
  },
};
