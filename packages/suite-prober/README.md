# @jkos/suite-prober — the synthetic sixth consumer

A **read-only** research instrument. It plays the role of a hypothetical sixth app
that wants to use *every* pathway across all five jkOS systems (jkAuth, BeigeBoard,
Weave, ORDECK, jkDeploy), then asserts the cross-system invariants such an app would
depend on. It **discovers** the suite the way Weave itself does — from the registry,
the manifest, the nginx peer table, each app's capability/dataset docs — except it
reads the source-of-truth *files*, so it runs in a plain checkout with no deployment.

It never writes to the suite. It finds and reports; it does not fix.

```
node packages/suite-prober/prove.mjs          # human report
node packages/suite-prober/prove.mjs --json    # machine report
```

Exit code is non-zero **only** on a `drift` finding (two sources that already claim to
agree, disagreeing). `consolidate` / `gap` / `info` are opportunities, never failures.

## Why it exists

`pnpm test:contracts` guards the *hard* contracts (token shape, codes parity, nginx
file sync). This prober looks one layer below that gate — at duplicated truth and
unenforced coupling that no single test owns because it spans systems. The findings
feed [Documentation/CONSOLIDATION.md](../../Documentation/CONSOLIDATION.md).

## How it is built to expand (nothing is hard-coded)

Three data seams; everything else is generic:

| To add… | Edit | The loaders/probes pick it up because… |
|---|---|---|
| a new **source-of-truth file** | `src/sources.mjs` | the loader iterates `SOURCES` by `kind` |
| a new app's **backend docs** | `BACKEND_DOCS` in `src/sources.mjs` | the doc scraper iterates that list |
| a new **pathway** (endpoint) | a row in `src/pathways.mjs` | the pathway probe walks the catalog |
| a new **invariant** | drop `NN-name.mjs` in `src/probes/` | `probes/index.mjs` auto-loads the dir |

A probe is `export default { id, title, run(model) -> Finding[] }`. A `Finding` is
`{ level, msg, where? }` with `level ∈ drift | consolidate | gap | info | ok`.

When a real sixth app ships, point the topology loader at a live base URL (the
`liveTopology(baseUrl)` adapter seam is the next extension — HTTP discovery instead of
file scraping) and the same probes run against the running suite.

## Current limitation (itself a finding)

Most source-of-truth tables are private module-locals (a `const` inside a closure, a
TS object Vite-only-imports), so the loader has to **scrape** them with tolerant
regex. The one table that is exported as data — `CODES` — is `require()`d cleanly.
That asymmetry is finding **C3**: export the suite's truths as data and these scrapers
become imports.
