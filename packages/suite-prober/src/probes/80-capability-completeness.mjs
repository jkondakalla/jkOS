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
 *   • json     — a `json` body/return field is the opaque ESCAPE HATCH a GUI/AI can't
 *     snap a stud onto. Legal (importItems genuinely needs it) but flagged, not failed.
 *   • filters  — a dataset's filters carry their OWN enforcement mapping (column/op) so
 *     the server derives its SQL filter from the declaration (single source, P3). A
 *     filter with no op means the enforcement is hand-written elsewhere — a drift surface.
 *
 * All findings are gap/ok (never drift): these are completeness opportunities a new app
 * trips on, not contradictions between sources that already claim to agree.
 */
export default {
  id: 'capability-completeness',
  title: 'Primitive I/O contract — typed returns, json escapes, single-source filters',
  run(model) {
    const out = [];
    for (const app of model.apps.values()) {
      const docs = app.docs;
      // Only inspectable when the docs are exported as data (real objects, not scraped).
      if (!docs || (!docs.capabilities && !docs.datasets)) continue;

      for (const c of docs.capabilities || []) {
        const label = `${app.id}.${c.id}`;
        if (Array.isArray(c.returns) && c.returns.length) {
          out.push({ level: 'ok', msg: `${label}: declares a typed \`returns\` (${c.returns.length} field${c.returns.length > 1 ? 's' : ''}) — its output can be wired onward`, where: [docs.file] });
        } else {
          out.push({ level: 'gap', msg: `${label}: no typed \`returns\` — declares its INPUT but not its OUTPUT, so a GUI/AI can't wire its result into the next lego`, where: [docs.file] });
        }
        const jsonFields = [...(c.body || []), ...(c.returns || [])].filter((f) => f.type === 'json').map((f) => f.name);
        if (jsonFields.length) {
          out.push({ level: 'gap', msg: `${label}: uses the \`json\` escape hatch (${jsonFields.join(', ')}) — an opaque blob a GUI/AI can't snap a stud onto; not fully lego-typed`, where: [docs.file] });
        }
      }

      for (const d of docs.datasets || []) {
        const filters = d.filters || [];
        const enforced = filters.filter((f) => f.op).length;
        for (const f of filters) {
          if (!f.op) {
            out.push({ level: 'gap', msg: `${app.id}.${d.id} filter '${f.name}' declares no enforcement op — its SQL filter must be hand-written separately (declared ≠ enforced drift surface)`, where: [docs.file] });
          }
        }
        if (filters.length) {
          out.push({
            level: enforced === filters.length ? 'ok' : 'gap',
            msg: `${app.id}.${d.id}: ${enforced}/${filters.length} filters carry their own enforcement (column/op) — the server derives its filter spec from the declaration (single source, P3)`,
            where: [docs.file],
          });
        }
      }
    }
    return out;
  },
};
