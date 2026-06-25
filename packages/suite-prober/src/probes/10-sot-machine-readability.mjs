/**
 * Are the suite's sources of truth importable as DATA, or re-typed prose that every
 * consumer must re-parse? This is the meta-finding: the more tables are private
 * module-locals, the more cross-checks have to be hand-written per test (which is
 * exactly why drift hides). The prober itself had to scrape most of them to run.
 */
export default {
  id: 'sot-machine-readability',
  title: 'Sources of truth exported as data vs scraped from source',
  run(model) {
    const out = [];
    for (const s of model.sources) {
      if (s.exported) {
        out.push({ level: 'ok', msg: `${s.label} is importable as data`, where: [s.file] });
      } else {
        out.push({
          level: 'consolidate',
          msg: `${s.label} is a private module-local — not importable, must be regex-scraped`,
          where: [s.file],
        });
      }
    }
    // The A2 payoff: the registry seed / SUITE_APPS / nginx peers no longer re-type the
    // app directory — each derives from the single source via a builder, so it can't drift.
    for (const d of model.derived || []) {
      out.push({
        level: 'ok',
        msg: `${d.label} derives from @jkos/suite-manifest via ${d.builder} — single source, cannot drift`,
        where: [d.file],
      });
    }
    for (const d of model.backendDocs) {
      if (d.exported) {
        out.push({
          level: 'ok',
          msg: `${d.app} CapabilityDoc/DatasetDoc are an importable module — tooling/AI read the same declarations the server serves`,
          where: [d.file],
        });
      } else {
        out.push({
          level: 'consolidate',
          msg: `${d.app} CapabilityDoc/DatasetDoc are inline consts in the server, not an importable module — no tool can lint them without parsing JS`,
          where: [d.file],
        });
      }
    }
    return out;
  },
};
