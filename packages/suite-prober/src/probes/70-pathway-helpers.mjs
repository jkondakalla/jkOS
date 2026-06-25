/**
 * Walk the pathway catalog (the sixth app's full surface) and surface:
 *   - 'gap'  every pathway carrying a known architectural gap (NO_USER_CONTEXT writes,
 *            undiscoverable AI endpoints, prod-deploy nginx inertness, global widgets,
 *            the prod-jkAuth staging dependency, the service-clients env, the unenforced
 *            invalidateOn triple, last-write-wins prefs) — the things a new app trips on.
 *   - 'info' backend data/auth pathways routed through a shared @jkos/* helper (the rule
 *            "never hand-roll" actively held) vs page/SSE routes where no helper applies.
 * This is catalog-driven, so adding an endpoint row in pathways.mjs extends coverage.
 */
import { PATHWAYS, SYSTEMS } from '../pathways.mjs';

export default {
  id: 'pathway-helpers',
  title: 'Pathway catalog — architectural gaps and shared-helper coverage',
  run() {
    const out = [];
    for (const sys of SYSTEMS) {
      const rows = PATHWAYS.filter((p) => p.system === sys);
      const withHelper = rows.filter((p) => p.helper).length;
      out.push({
        level: 'info',
        msg: `${sys}: ${rows.length} pathways catalogued, ${withHelper} routed through a named shared helper`,
      });
    }
    for (const p of PATHWAYS) {
      if (p.gap) {
        out.push({ level: 'gap', msg: `${p.system}.${p.id} (${p.method} ${p.path}): ${p.gap}` });
      }
    }
    return out;
  },
};
