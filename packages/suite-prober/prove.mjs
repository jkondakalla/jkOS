/**
 * prove.mjs — run the sixth app.
 *
 * Loads the suite topology from the real source-of-truth files, runs every probe in
 * src/probes/, prints a grouped findings report, and exits non-zero ONLY on 'drift'
 * (a hard inconsistency between sources that already claim to agree). 'consolidate' /
 * 'gap' / 'info' are reported but never fail the run — they are opportunities, not
 * regressions. Read-only: this process writes nothing back to the suite.
 *
 *   node prove.mjs                         human report (file mode)
 *   node prove.mjs --json                  machine report (for piping into CI)
 *   node prove.mjs --live <baseUrl>        run against a DEPLOYED stack (TEST-1); the
 *                                          1NN-live-* probes turn on and health / doc /
 *                                          gate liveness are asserted over HTTP. Add
 *                                          --token <jwt> (or PROBE_TOKEN) to validate the
 *                                          authed directory + gated docs too.
 *
 * In file mode the live-only probes are inert, so this stays the same read-only gate.
 * A `--live` run exits non-zero on drift exactly like file mode (a dead deployment IS a
 * hard contract break), so it can gate a post-deploy smoke.
 */
import { loadTopology } from './src/topology.mjs';
import { liveTopology } from './src/live.mjs';
import { loadProbes } from './src/probes/index.mjs';

const ICON = { drift: '✗', consolidate: '⊕', gap: '▲', info: 'ℹ', ok: '✓' };
const ORDER = ['drift', 'consolidate', 'gap', 'info', 'ok'];

const argv = process.argv.slice(2);
const flagValue = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const json = argv.includes('--json');
const liveBase = flagValue('--live');
const token = flagValue('--token') || process.env.PROBE_TOKEN || null;

const model = liveBase ? await liveTopology(liveBase, { token }) : loadTopology();
const probes = await loadProbes();

const results = probes.map((p) => ({ probe: p, findings: p.run(model) }));

if (json) {
  console.log(JSON.stringify(
    results.map((r) => ({ id: r.probe.id, title: r.probe.title, findings: r.findings })),
    null, 2,
  ));
  process.exit(results.some((r) => r.findings.some((f) => f.level === 'drift')) ? 1 : 0);
}

const tally = { drift: 0, consolidate: 0, gap: 0, info: 0, ok: 0 };

console.log('\n  jkOS suite-prober — the synthetic sixth consumer');
console.log('  topology: ' +
  `${model.apps.size} apps · ${model.registry.length} registry rows · ` +
  `${model.manifest.length} manifest entries · ${model.nginxPeers.length} nginx peers · ` +
  `${Object.keys(model.codes).length} codes`);
if (model.live) {
  console.log(`  LIVE against ${model.live.baseUrl} ` +
    `(${model.live.authenticated ? 'authenticated' : 'unauthenticated'}, ` +
    `probed ${Object.keys(model.live.apps).length} app surfaces at ${model.live.fetchedAt})`);
}
console.log('');

for (const { probe, findings } of results) {
  console.log(`── ${probe.title}  [${probe.id}]`);
  const sorted = [...findings].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  for (const f of sorted) {
    tally[f.level] = (tally[f.level] || 0) + 1;
    const where = f.where?.length ? `\n        ↳ ${f.where.join('  ')}` : '';
    console.log(`   ${ICON[f.level] || '·'} [${f.level}] ${f.msg}${where}`);
  }
  console.log('');
}

console.log('── summary');
for (const lvl of ORDER) console.log(`   ${ICON[lvl]} ${lvl.padEnd(12)} ${tally[lvl] || 0}`);
console.log(`\n  ${tally.drift ? '✗ DRIFT present — sources that must agree do not.' :
  '✓ no drift — hard contracts hold; the rest are consolidation opportunities.'}\n`);

process.exit(tally.drift ? 1 : 0);
