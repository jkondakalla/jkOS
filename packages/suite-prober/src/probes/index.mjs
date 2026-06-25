/**
 * probes/index.mjs — collect every probe in this directory.
 *
 * A probe is a module with a default export `{ id, title, run(model) -> Finding[] }`.
 * Drop a new `NN-name.mjs` file in here and it is picked up automatically — the
 * expandable seam for "assert one more cross-system invariant". Files are loaded in
 * filename order (the NN prefix) so the report reads top-to-bottom intentionally.
 *
 * A Finding is `{ level, msg, where? }` where level ∈
 *   'drift'       sources that MUST already agree do not — a real defect (fails CI)
 *   'consolidate' duplicated / coupled truth that could collapse to one source
 *   'gap'         a missing enforcement or capability a new app would trip on
 *   'info'        an asymmetry worth seeing, believed intentional
 *   'ok'          an invariant actively held
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadProbes() {
  const files = readdirSync(here)
    .filter((f) => /^\d.*\.mjs$/.test(f))
    .sort();
  const probes = [];
  for (const f of files) {
    const mod = await import(join(here, f));
    if (mod.default) probes.push(mod.default);
  }
  return probes;
}
