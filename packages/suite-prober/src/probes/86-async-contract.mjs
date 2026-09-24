/**
 * The async result contract — `resolves` (WV-5, WEAVE.md §3.1).
 *
 * ⚠️ THE DEFECT, stated as the audit found it: every LazurOS capability declared
 * `returns: [{ name:'job_id', type:'string' }]`. That is CORRECT for the HTTP
 * response — you really do get a job handle — and USELESS for composition, because a
 * binding engine reading `returns` sees a `string` where the real answer lives and
 * will cheerfully type-check a job UUID into a task title. It would not error. It
 * would create a task called `a3f1c8e2-…`, and the only symptom is a nonsense row
 * nobody can trace back.
 *
 * ⚠️ AND IT GATES THE WIDGET FACTORY. `WidgetSpec` binds a dataset into a primitive
 * tree (read); `TriggerDef` binds a capability's typed output into another's body
 * (write). Converging those two onto one binding model is the spec the factory is
 * built from — and it cannot be specified while the write half's type information is
 * a lie for every asynchronous capability in the suite.
 *
 * So: a capability whose `returns` is a bare HANDLE must declare what its WORK
 * produces. The presence of `resolves` IS the declaration that a capability is
 * asynchronous — there is deliberately no separate `async: true` flag, because two
 * fields that must agree are two fields that can disagree.
 *
 * Reported as DRIFT, not gap: an undeclared async result is not a missing nicety, it
 * is type information that is actively WRONG, and a binder trusts it.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';
import { BACKEND_DOCS } from '../sources.mjs';

const require = createRequire(import.meta.url);

/* What a job handle looks like: a single field whose name says "this is a ticket,
   come back later". Matched on the NAME rather than on the type, because the type is
   `string` — which is exactly why the defect was invisible. */
const HANDLE_NAMES = new Set(['job_id', 'jobId', 'job', 'task_id', 'taskId', 'handle', 'id']);

const isHandle = (returns) =>
  Array.isArray(returns) && returns.length === 1 && HANDLE_NAMES.has(returns[0]?.name);

export default {
  id: 'async-contract',
  title: 'Async capabilities declare what they RESOLVE to, not just what they return',
  run() {
    const out = [];
    let declared = 0;
    let sync = 0;

    for (const entry of BACKEND_DOCS) {
      let doc;
      try {
        const mod = require(join(REPO_ROOT, entry.module));
        doc = mod.CAPABILITIES ?? mod.CAPABILITIES_DOC;
      } catch { continue; }
      for (const cap of doc?.capabilities ?? []) {
        const where = [entry.module];
        const handle = isHandle(cap.returns);

        if (handle && !Array.isArray(cap.resolves)) {
          out.push({
            level: 'drift',
            msg: `'${entry.app}'.${cap.id} returns a bare handle ('${cap.returns[0].name}') and declares no \`resolves\` — `
              + 'a binder reading `returns` sees a string where the result lives and will type-check a job id into a '
              + 'text field. Declare what the WORK produces.',
            where,
          });
          continue;
        }

        if (Array.isArray(cap.resolves)) {
          if (!cap.resolves.length) {
            out.push({
              level: 'drift',
              msg: `'${entry.app}'.${cap.id} declares an empty \`resolves\` — an async capability that produces nothing `
                + 'should omit the field, not declare emptiness.',
              where,
            });
            continue;
          }
          const untyped = cap.resolves.filter((f) => !f || typeof f.name !== 'string' || typeof f.type !== 'string');
          if (untyped.length) {
            out.push({
              level: 'drift',
              msg: `'${entry.app}'.${cap.id} has ${untyped.length} \`resolves\` field(s) missing a name or type — `
                + 'an untyped stud is the same hole in a different place.',
              where,
            });
            continue;
          }
          /* ⚠️ The one that would silently undo the fix: re-declaring the handle as
             the result. It satisfies "has resolves" and restores the exact defect. */
          if (cap.resolves.length === 1 && HANDLE_NAMES.has(cap.resolves[0].name)) {
            out.push({
              level: 'drift',
              msg: `'${entry.app}'.${cap.id} \`resolves\` to '${cap.resolves[0].name}' — that is the HANDLE again, `
                + 'not what the work produces. This declaration reinstates exactly the defect it exists to close.',
              where,
            });
            continue;
          }
          declared++;
        } else {
          sync++;
        }
      }
    }

    if (declared) {
      out.push({
        level: 'ok',
        msg: `${declared} asynchronous capability(ies) declare what their work RESOLVES to, distinct from the handle `
          + `they return; ${sync} synchronous ones compose on \`returns\` as before`,
        where: ['packages/weave/src/capability.ts', 'packages/weave/src/server/trigger.js'],
      });
    }
    return out;
  },
};
