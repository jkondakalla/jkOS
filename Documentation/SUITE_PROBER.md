# jkOS — Suite Prober (the conformance instrument)

A read-only harness that plays a **synthetic sixth app**: it wants to use every pathway
across all five systems, then asserts the cross-system invariants such an app relies on.
It lives at [../packages/suite-prober/](../packages/suite-prober/). It **discovers** the
suite the way Weave itself does — registry → manifest → nginx peers → each app's
capability/dataset docs — except it reads the source-of-truth *files*, so it runs in a
plain checkout with no deployment. It finds and reports; it never writes to the suite.

```
node packages/suite-prober/prove.mjs          # human report
node packages/suite-prober/prove.mjs --json    # machine report (for CI / write-ups)
```

> The detailed operating manual (run, extend, internals) lives in the package's own
> [README](../packages/suite-prober/README.md). This page is the suite-level framing —
> what it is, where it fits, what it currently checks. When the two disagree, the code wins.

## Where it fits — the conformance layer

The suite already has a hard-contract gate; the prober is the advisory layer beneath it.

| Layer | What it guards | Mechanism |
|-------|----------------|-----------|
| **`pnpm test:contracts`** | Hard contracts that already broke once — token shape, codes vocab node↔python parity, issuer/cookie single-source, nginx file sync | Bespoke per-contract assertions ([WEAVE.md](WEAVE.md) → contract gate) |
| **suite-prober** | The layer below the gate — *duplicated truth* and *unenforced coupling* that spans systems, so no single existing test owns it | One topology model + a registry of cross-system probes |

The prober is **why** [CONSOLIDATION.md](CONSOLIDATION.md) exists: it produced those
findings. Its headline today is **0 drift / 1 consolidate / 7 gap** (2026-07-01 sweep:
the app-directory consolidations are closed — registry/manifest/nginx all derive from
`@jkos/suite-manifest`, the invalidation triple collapsed into `useWeaveList`'s derived
subscription, and LazurOS's doc surface is covered; the one remaining consolidate is the
off-limits SylibOS `sylib` slug).

## The mental model

The suite's core principle is *discovery over hardcoding* — an app is one registry row and
the portal derives the rest. The prober is the same principle applied to **testing**: it
does not hardcode "BeigeBoard has these capabilities." It discovers the topology from the
real sources and runs generic invariants over it. **A new app or a new check is data, not
harness code** — so the instrument expands automatically as the suite grows.

## What it checks today

Each probe is a self-contained module in [`src/probes/`](../packages/suite-prober/src/probes/);
findings are classified `drift` (a real defect — fails CI) · `consolidate` (collapsible
duplication) · `gap` (missing enforcement a new app trips on) · `info` · `ok`.

| Probe | Surfaces |
|-------|----------|
| `sot-machine-readability` | Which sources of truth are importable data vs scraped module-locals (only `CODES` is data) |
| `app-list-parity` | Registry seed vs `SUITE_APPS` membership drift |
| `slug-vs-id` | The central finding — an app's edge slug (`bb`) ≠ its id (`beigeboard`), re-typed across 4 sources |
| `registry-manifest-fields` | Integration fields duplicated verbatim between registry and manifest |
| `invalidation-keys` | The free-form bus key (`bb.items`) repeated on capability + dataset + every widget, unenforced |
| `scope-identifier` | Capability scopes namespace on the *id* while the edge/bus use the *slug* — two identifiers per app |
| `pathway-helpers` | Walks the pathway catalog: every system's shared-helper coverage + the known architectural gaps |

The **pathway catalog** ([`src/pathways.mjs`](../packages/suite-prober/src/pathways.mjs))
is the "sixth app" expressed as data — every endpoint/fn it would touch across jkAuth,
BeigeBoard, Weave, ORDECK, and jkDeploy, annotated with the shared helper it should use and
any gap. Adding an endpoint there extends coverage with no probe edits.

## How it expands (the data seams)

| To add… | Edit |
|---|---|
| a new source-of-truth file | `SOURCES` in [`src/sources.mjs`](../packages/suite-prober/src/sources.mjs) |
| a new app's backend docs | `BACKEND_DOCS` in the same file |
| a new pathway | a row in [`src/pathways.mjs`](../packages/suite-prober/src/pathways.mjs) |
| a new invariant | drop `NN-name.mjs` in [`src/probes/`](../packages/suite-prober/src/probes/) (auto-loaded) |

When a real sixth app ships, point the loader at a live base URL (the `liveTopology(baseUrl)`
adapter seam — HTTP discovery instead of file scraping) and the same probes run against the
running suite. See the package README for the seam details.

## Roadmap

Currently **advisory** (reports, never fails a build). It is slated to **graduate into the
gate** — promote the add-time subset of checks (`slug≠id`, registry↔manifest mismatch, a
bad `invalidates` prefix, a registered app with no nginx block, a non-id scope namespace)
to `drift` and chain `prove.mjs` into `pnpm test:contracts`. That makes a malformed app-add
fail red with a precise message — the feedback loop an AI implementer needs. Tracked as
**Phase 0** of [ToDo.md §1](ToDo.md).

## Guarantee

Read-only. It reads source files and (optionally) probes live endpoints; it writes nothing
back to any of the five systems. Safe to run anytime, in any checkout, in CI.
