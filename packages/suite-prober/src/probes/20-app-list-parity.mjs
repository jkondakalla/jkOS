/**
 * Two "app list" VIEWS exist — the jkAuth app_registry seed and the Weave SUITE_APPS
 * manifest. Post-A2 both are DERIVED from @jkos/suite-manifest (registrySeed() /
 * manifestApps()), so membership differences are filters (an app with no probeable
 * surface has no manifest entry), not drift. This probe verifies the consumers still
 * CALL the builders — if either reverts to a hand-kept copy, the duplicate-list
 * finding comes back as 'consolidate'.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';

const REG_FILE = 'apps/jkauth/src/db.js';
const MAN_FILE = 'packages/weave/src/manifest.ts';

export default {
  id: 'app-list-parity',
  title: 'Registry seed vs SUITE_APPS manifest — membership',
  run(model) {
    const out = [];
    for (const app of model.apps.values()) {
      if (app.inRegistry && app.inManifest) {
        out.push({ level: 'ok', msg: `'${app.id}' is declared in both lists` });
      } else if (app.inRegistry) {
        out.push({
          level: 'info',
          msg: `'${app.id}' is in the registry seed but not SUITE_APPS (no probeable api/health surface — a filter of the one source, not drift)`,
          where: [REG_FILE],
        });
      } else {
        out.push({
          level: 'info',
          msg: `'${app.id}' is in SUITE_APPS but NOT in the registry seed`,
          where: [MAN_FILE],
        });
      }
    }

    // The consolidation guard: both consumers must still derive their view from the
    // single source. Text-level check on purpose — the topology reads the builders
    // directly, so only the consumer files can tell us a hand-kept copy came back.
    const regDerives = readFileSync(join(REPO_ROOT, REG_FILE), 'utf8').includes('registrySeed()');
    const manDerives = readFileSync(join(REPO_ROOT, MAN_FILE), 'utf8').includes('manifestApps(');
    if (regDerives && manDerives) {
      out.push({
        level: 'ok',
        msg: 'One app list: the registry seed and SUITE_APPS both derive from @jkos/suite-manifest builders — parity is by construction',
        where: [REG_FILE, MAN_FILE],
      });
    } else {
      out.push({
        level: 'consolidate',
        msg: `A derived view stopped deriving (${regDerives ? '' : 'registry seed '}${manDerives ? '' : 'SUITE_APPS '}no longer calls its suite-manifest builder) — a hand-kept duplicate of the app list is back`,
        where: [REG_FILE, MAN_FILE],
      });
    }
    return out;
  },
};
