/**
 * TEST-12 · Port registry — every test port is claimed once, in one table, and the
 * files agree with it.
 *
 * The failure this exists to catch is OPS-1: BeigeBoard's routines/routine-spec
 * smokes and PapyrOS's playback/meta smokes each shared a port (3991/3992), and two
 * stray processes on those ports once ran eight assertions green against the WRONG
 * app's server. The registry (`TEST_PORTS` in @jkos/suite-manifest/apps.js) is the
 * single source a new smoke claims from; `portTable()` already refuses to load on a
 * duplicate claim. What the table cannot see is the FILES — a smoke whose
 * `const PORT = <n>` literal drifts from its claim, or a smoke that never claimed at
 * all, recreates the shared-port hole without touching the registry. This probe
 * closes that half:
 *
 *   drift        two claimants on one port; a smoke literal ≠ its registry claim;
 *                a port-binding smoke with no registry row
 *   consolidate  a registry claim no file carries any more (a dead row)
 *   ok           the table and the files agree
 *
 * sylibos is intentionally excluded (off-limits).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '../topology.mjs';

const require = createRequire(import.meta.url);

/** Every file that may bind a localhost test port, with its claimant key. */
function portClaimingFiles() {
  const files = [];
  const appsDir = join(REPO_ROOT, 'apps');
  for (const app of readdirSync(appsDir)) {
    if (app === 'sylibos') continue;
    const testDir = join(appsDir, app, 'backend', 'test');
    if (!existsSync(testDir)) continue;
    for (const f of readdirSync(testDir)) {
      if (!f.endsWith('.mjs')) continue;
      files.push({ claimant: `${app}:${basename(f, '.mjs')}`, path: join(testDir, f) });
    }
  }
  files.push({
    claimant: 'suite-prober:roundtrip',
    path: join(REPO_ROOT, 'packages', 'suite-prober', 'roundtrip.mjs'),
  });
  return files;
}

export default {
  id: 'port-registry',
  title: 'Port registry — one claimant per port, and the smoke literals match the table',

  run() {
    const out = [];
    let manifest;
    try {
      manifest = require(join(REPO_ROOT, 'packages', 'suite-manifest', 'apps.js'));
    } catch (e) {
      // portTable() runs at module load and throws on a duplicate claim.
      out.push({ level: 'drift', msg: `suite-manifest refused to load: ${e.message}`, where: ['packages/suite-manifest/apps.js'] });
      return out;
    }
    const { TEST_PORTS } = manifest;

    const seenClaims = new Set();
    let filesChecked = 0;
    for (const { claimant, path } of portClaimingFiles()) {
      const src = readFileSync(path, 'utf8');
      const m = src.match(/^\s*const PORT = (\d+);?\s*$/m);
      if (!m) continue; // no fixed port bound — nothing to claim
      filesChecked++;
      const literal = Number(m[1]);
      const claimed = TEST_PORTS[claimant];
      const rel = path.slice(REPO_ROOT.length + 1);
      if (claimed === undefined) {
        out.push({
          level: 'drift',
          msg: `'${claimant}' binds port ${literal} with no registry row — claim it in TEST_PORTS`,
          where: [rel],
        });
        continue;
      }
      seenClaims.add(claimant);
      if (claimed !== literal) {
        out.push({
          level: 'drift',
          msg: `'${claimant}' binds ${literal} but the registry says ${claimed} — the table and the file must agree`,
          where: [rel],
        });
      }
    }

    for (const claimant of Object.keys(TEST_PORTS)) {
      if (!seenClaims.has(claimant)) {
        out.push({
          level: 'consolidate',
          msg: `registry claim '${claimant}' (port ${TEST_PORTS[claimant]}) matches no file — a dead row`,
          where: ['packages/suite-manifest/apps.js'],
        });
      }
    }

    if (!out.length) {
      out.push({
        level: 'ok',
        msg: `${filesChecked} port-binding test files, every literal matching its claim; ` +
             `${manifest.portTable().length} claimants, no two on one port (services included)`,
        where: ['packages/suite-manifest/apps.js'],
      });
    }
    return out;
  },
};
