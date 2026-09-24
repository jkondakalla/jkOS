/**
 * Is each primitive a fully-typed lego, or does it lean on an escape hatch? The
 * lego property (ToDo Layer A): a non-technical user composes via a GUI / by describing
 * intent to an AI, so a primitive is only safely snap-together-able when it is fully
 * typed + self-describing. This probe makes "is this capability lego-ready?" a
 * re-runnable check over the IMPORTED declarations (needs the docs exported as data —
 * see the sot-machine-readability probe). Three properties:
 *
 *   • returns  — a capability declares its OUTPUT stud (typed `returns`), not just its
 *     INPUT, so a GUI/AI can wire one lego's result into the next's input. Missing → gap.
 *   • json     — a `json` body/return field is a DOCUMENT. It is a gap only when it
 *     does not say WHAT document: `schema` names the dataset whose rows it carries or
 *     the doc where its shape is written, and this probe resolves that pointer (a
 *     dataset that does not exist, or a file that does not, is drift — an unverifiable
 *     pointer is the escape hatch again with a reassuring label on it).
 *   • filters  — a dataset's filters carry their OWN enforcement mapping (column/op) so
 *     the server derives its SQL filter from the declaration (single source, P3). A
 *     filter with no op means the enforcement is hand-written elsewhere — a drift surface.
 *
 * All findings are gap/ok (never drift): these are completeness opportunities a new app
 * trips on, not contradictions between sources that already claim to agree.
 */

/* ⚠️ These imports were MISSING, and the file-path half of the `schema` check below
   (D3: "the dataset whose rows it carries, or the doc where its shape is written") had
   never once run: every capability's `json` pointer named a dataset, so the branch
   calling `existsSync(join(REPO_ROOT, …))` was never reached, and the first pointer at
   a file (KourOS's session capabilities, 2026-09-24) threw a ReferenceError that took
   the whole prove run down instead of reporting a finding. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';
/** Normalize a capability's declared I/O across the two doc dialects in the suite:
 *  the Layer-A canonical shape (`body`/`returns` as arrays of {name,type} fields —
 *  BeigeBoard) and the map dialect (`fields` array with `id` keys + `returns` as a
 *  name→type object — LazurOS). Both are typed; only the spelling differs. */
function normalizeFields(v) {
  /* ⚠️ `schema` is carried through. This projection dropped every key but name+type,
     so the json check below could never have SEEN a schema pointer no matter how
     many were declared — it would have gone on reporting the same ten gaps against
     a fully annotated suite, which is the quietest way for a probe to be wrong. */
  if (Array.isArray(v)) return v.map((f) => ({ name: f.name ?? f.id, type: f.type, schema: f.schema }));
  if (v && typeof v === 'object') return Object.entries(v).map(([name, type]) => ({ name, type }));
  return [];
}

/** Is this `schema` pointer resolvable? Returns null when it is, else why not. */
function badSchemaRef(ref, model) {
  const s = String(ref || '');
  if (s.includes('/')) {
    return existsSync(join(REPO_ROOT, s)) ? null : `no such file '${s}'`;
  }
  const [appId, ...rest] = s.split('.');
  const datasetId = rest.join('.');
  if (!appId || !datasetId) return "not an '<app>.<dataset>' reference nor a repo file path";
  const app = model.apps.get(appId);
  if (!app) return `no app '${appId}' in the suite manifest`;
  const ids = (app.docs?.datasets || []).map((d) => d.id);
  if (!ids.length) return `'${appId}' exports no datasets to resolve '${datasetId}' against`;
  return ids.includes(datasetId) ? null : `'${appId}' declares no dataset '${datasetId}'`;
}

export default {
  id: 'capability-completeness',
  title: 'Primitive I/O contract — typed returns, json escapes, single-source filters',
  run(model) {
    const out = [];
    let declaredDocs = 0;
    for (const app of model.apps.values()) {
      const docs = app.docs;
      // Only inspectable when the docs are exported as data (real objects, not scraped).
      if (!docs || (!docs.capabilities && !docs.datasets)) continue;

      const mapDialect = (docs.capabilities || []).some((c) => c.returns && !Array.isArray(c.returns));
      if (mapDialect) {
        out.push({
          level: 'consolidate',
          msg: `'${app.id}' declares capabilities in the map dialect (\`fields\` + \`returns: {name: type}\`) while the Layer-A canonical shape is \`body\`/\`returns\` field arrays — same information, second spelling; collapse when its doc next changes`,
          where: [docs.file],
        });
      }

      for (const c of docs.capabilities || []) {
        const label = `${app.id}.${c.id}`;
        const returns = normalizeFields(c.returns);
        const body = normalizeFields(c.body ?? c.fields);
        if (returns.length) {
          out.push({ level: 'ok', msg: `${label}: declares a typed \`returns\` (${returns.length} field${returns.length > 1 ? 's' : ''}) — its output can be wired onward`, where: [docs.file] });
        } else {
          out.push({ level: 'gap', msg: `${label}: no typed \`returns\` — declares its INPUT but not its OUTPUT, so a GUI/AI can't wire its result into the next lego`, where: [docs.file] });
        }
        /* ⚠️ A `json` field is NOT automatically a gap (D3's remainder). Treating
           the seven flagged fields as one defect was the wrong reading — they are
           two different things:
             · a LIST OF KNOWN ROWS whose shape was simply never declared (a real
               defect: `blocked_by` is item rows, `candidate` is a metadataSearch row)
             · a RECURSIVE DOCUMENT that cannot be flattened into a BodyField[] at all
               (a routine `spec` is forty steps with phases and progression rules; an
               import `items` is an arbitrarily nested tree). Here the hatch is an
               HONEST DESCRIPTION, and the defect was that nothing said WHERE the
               shape lives.
           So the question is not "is it json" but "does it say what it is".
           `schema` names either a dataset ('<app>.<dataset>') or a doc file, and
           both are checked below — an unverifiable pointer is the same hole with a
           reassuring label on it. */
        const jsonFields = [...body, ...returns].filter((f) => f.type === 'json');
        const undeclared = jsonFields.filter((f) => !f.schema).map((f) => f.name);
        if (undeclared.length) {
          out.push({ level: 'gap', msg: `${label}: \`json\` field(s) with no \`schema\` (${undeclared.join(', ')}) — an opaque blob a GUI/AI can't snap a stud onto. Name the dataset whose rows it carries, or the doc where its shape is written.`, where: [docs.file] });
        }
        for (const f of jsonFields.filter((x) => x.schema)) {
          const bad = badSchemaRef(f.schema, model);
          if (bad) {
            out.push({ level: 'drift', msg: `${label}.${f.name} declares \`schema: '${f.schema}'\` — ${bad}. A pointer that resolves to nothing is the escape hatch again, wearing a label.`, where: [docs.file] });
          } else {
            declaredDocs++;
          }
        }
      }

      for (const d of docs.datasets || []) {
        const all = d.filters || [];
        // A `computed: true` filter is a PARAMETER to a computation, not a WHERE
        // clause: `k` on a similarity search, `arc` on a generated run, `x`/`y`
        // on a 2-D map. It has no column to map to and never will, so demanding
        // an enforcement op of it is asking the wrong question — and answering
        // it with `column: null` produced a page of gaps saying "hand-written
        // elsewhere" about values that are arguments, not filters. Declaring
        // them still matters (a consumer must know `k` exists); what does not
        // apply is the declared-vs-enforced SQL check.
        const computed = all.filter((f) => f.computed);
        const filters = all.filter((f) => !f.computed);
        const enforced = filters.filter((f) => f.op).length;
        for (const f of filters) {
          if (!f.op) {
            out.push({ level: 'gap', msg: `${app.id}.${d.id} filter '${f.name}' declares no enforcement op — its SQL filter must be hand-written separately (declared ≠ enforced drift surface)`, where: [docs.file] });
          }
        }
        if (filters.length) {
          out.push({
            level: enforced === filters.length ? 'ok' : 'gap',
            msg: `${app.id}.${d.id}: ${enforced}/${filters.length} filters carry their own enforcement (column/op) — the server derives its filter spec from the declaration (single source, P3)`
               + (computed.length ? ` (+${computed.length} computed parameter${computed.length === 1 ? '' : 's'}, not SQL-backed)` : ''),
            where: [docs.file],
          });
        } else if (computed.length) {
          out.push({
            level: 'ok',
            msg: `${app.id}.${d.id}: ${computed.length} computed parameter${computed.length === 1 ? '' : 's'} and no SQL filters — a computed read, correctly declared`,
            where: [docs.file],
          });
        }
      }
    }
    if (declaredDocs) {
      out.push({
        level: 'ok',
        msg: `${declaredDocs} \`json\` document field(s) name a resolvable schema — the escape hatch is now an honest `
          + 'description (a routine spec IS a document) rather than an undeclared blob, and every pointer resolves',
        where: ['packages/weave/src/capability.ts'],
      });
    }
    return out;
  },
};
