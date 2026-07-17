/**
 * LIVE-ONLY probe (runs only under `prove --live`; a no-op in file mode).
 *
 * `/auth/apps` is the deployed suite directory, seeded from @jkos/suite-manifest at
 * migration time. This asserts the DEPLOYED registry membership still matches the source
 * the checkout ships — a registry that drifted from the manifest (an app added to the
 * source but never re-seeded, or a stale row) is exactly the kind of "looks fine in git,
 * wrong in prod" defect that no file probe can see. Requires a token (the endpoint is
 * authed); without one the check is `info` (skipped), never a false drift.
 */
export default {
  id: 'live-directory',
  title: 'Live edge — deployed /auth/apps registry matches the manifest source',
  run(model) {
    if (!model.live) return [];
    const dir = model.live.directory;
    const where = [`${model.live.baseUrl}/auth/apps`];

    if (dir?.status === 401 || dir?.status === 403) {
      return [{ level: 'info', msg: `directory parity skipped — /auth/apps is ${dir.status} (authed endpoint); pass --token to compare the deployed registry`, where }];
    }
    if (!dir || dir.status !== 200 || !dir.body || !Array.isArray(dir.body.apps)) {
      return [{ level: 'drift', msg: `/auth/apps did not return an { apps:[] } directory (status ${dir?.status}${dir?.error ? `, ${dir.error}` : ''})`, where }];
    }

    const liveIds = new Set(dir.body.apps.map((a) => a.id));
    // The source membership: every app with a registry row (registry !== false).
    const sourceIds = new Set(model.registry.map((r) => r.id));

    const missing = [...sourceIds].filter((id) => !liveIds.has(id));
    const extra = [...liveIds].filter((id) => !sourceIds.has(id));
    const out = [];
    if (missing.length) out.push({ level: 'drift', msg: `deployed registry is MISSING ${missing.length} app(s) the manifest seeds — re-seed needed`, where: missing });
    if (extra.length) out.push({ level: 'drift', msg: `deployed registry has ${extra.length} app(s) NOT in the manifest source — stale row(s)`, where: extra });
    if (!out.length) out.push({ level: 'ok', msg: `deployed registry membership matches the manifest (${liveIds.size} apps)`, where });
    return out;
  },
};
