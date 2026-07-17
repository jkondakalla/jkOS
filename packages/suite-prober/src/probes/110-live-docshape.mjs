/**
 * LIVE-ONLY probe (runs only under `prove --live`; a no-op in file mode).
 *
 * The docShape rule the servers enforce at boot and the browser read-path checks on
 * consume — validated here against what the DEPLOYED edge actually serves. For every app
 * advertising a capabilities / datasets path we fetch the doc and run the SAME
 * `checkDocShape` weave uses ({app, version, list[]} with string ids), and assert the
 * served `app` field equals the canonical id. A malformed or wrong-app live doc is
 * `drift`; an auth-gated doc is `info` (supply a token). This is the live half of the
 * file-mode docShape guarantee: the checkout can be perfect while the deployment serves
 * a stale or broken doc.
 */
import { checkDocShape } from '../../../weave/src/shared/docShape.js';

/** One doc surface (capabilities|datasets): map the fetched record → findings. */
function inspect(id, listKey, rec, live) {
  const path = listKey === 'capabilities'
    ? `/api/${id}/capabilities` : `/api/${id}/datasets`;
  const where = [`${live.baseUrl}${path}`];
  if (!rec || rec.status === 0) {
    return [{ level: 'drift', msg: `'${id}' ${listKey}: unreachable (${rec?.error || 'no response'}) — advertised doc surface dead at the edge`, where }];
  }
  if (rec.status === 404 || rec.status >= 500) {
    return [{ level: 'drift', msg: `'${id}' ${listKey}: ${rec.status} through the edge — advertised but not served`, where }];
  }
  if (rec.status === 401 || rec.status === 403) {
    return [{ level: 'info', msg: `'${id}' ${listKey}: ${rec.status} — gated at the edge; supply a token to validate the served doc`, where }];
  }
  if (rec.status !== 200 || !rec.body || typeof rec.body !== 'object') {
    return [{ level: 'drift', msg: `'${id}' ${listKey}: ${rec.status} with a non-object body — not a discovery doc`, where }];
  }
  const err = checkDocShape(rec.body, listKey);
  if (err) {
    return [{ level: 'drift', msg: `'${id}' ${listKey}: served doc fails checkDocShape — ${err}`, where }];
  }
  if (rec.body.app !== id) {
    return [{ level: 'drift', msg: `'${id}' ${listKey}: served doc declares app '${rec.body.app}' ≠ canonical id '${id}'`, where }];
  }
  const n = (rec.body[listKey] || []).length;
  return [{ level: 'ok', msg: `'${id}' ${listKey}: served doc validates (v${rec.body.version}, ${n} ${listKey})`, where }];
}

export default {
  id: 'live-docshape',
  title: 'Live edge — served capability/dataset docs validate over HTTP',
  run(model) {
    if (!model.live) return [];
    const out = [];
    for (const [id, rec] of Object.entries(model.live.apps)) {
      const reg = model.apps.get(id)?.registry;
      if (reg?.capabilitiesPath) out.push(...inspect(id, 'capabilities', rec.capabilities, model.live));
      if (reg?.datasetsPath) out.push(...inspect(id, 'datasets', rec.datasets, model.live));
    }
    return out;
  },
};
