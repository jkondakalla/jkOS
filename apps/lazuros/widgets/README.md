# LazurOS's ORDECK widgets

Each `<id>.json` here is a widget; ORDECK compiles every app's `widgets/*.json` in at build
time (`apps/ordeck/src/hud/catalog.ts`), so they are on every HUD's shelf after a deploy —
no publishing step. They are AI-backed (they bind LazurOS), so the suite's AI kill switch
hides them from the shelf and turns a placed one into an "AI is off" tile.

- **`lazuros-query.json` — Ask LazurOS.** One `ask` pattern over the `query` capability. The
  question goes as `text`; `query` is async (it declares `resolves: [{ response }]`), so the
  call answers `202 { job_id }` and the pattern follows the job through the jobs dataset until
  it ends, then draws `$result.response` under the question — or the error.
- **`lazuros-jobs.json` — LazurOS Jobs.** One source, the `jobs` dataset LazurOS declares
  (`backend/docs.js`), refreshed when a capability invalidates `lazuros.jobs` and every 8 s
  (the worker that finishes a job is not in the browser). One `rows` pattern: a dot whose
  tone is the status mapped onto tones, the status as a word, the capability, the error on a
  row that has one, and how long ago. The frame draws loading, offline, signed-out and empty.
  `lazuros-jobs.fixtures.json` is what the preview draws; the gate holds it to the dataset's
  declared row.

Change one, then:

```
pnpm widget check apps/lazuros/widgets/lazuros-jobs.json   # both validation tiers
pnpm widget shot lazuros-jobs                               # every tier × state, both faces
```

and look at the PNGs. `pnpm test:contracts` holds every widget file to both tiers
(`check:widgets`) and draws it (`check:widget-render`).
