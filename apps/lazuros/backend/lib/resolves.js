'use strict';
// resolves.js — what a finished job RESOLVES to, projected from what the worker answered.
//
// Every capability declares `resolves` (docs.js): what its WORK produces, as distinct
// from the job handle the call returns (WEAVE.md §3.1). The worker answers the same
// thing for all of them — `{ response, model }`, the model's text and its name — and
// that answer used to be stored as the job's `result` verbatim. So `parse-task`
// declared it resolves to `{ items, defaults }` while the one place anyone could read
// its result (the `jobs` dataset) said `{ response: "<json text>", model }`: a widget
// binding `$result.items`, or a trigger firing on the job's completion, read nothing.
//
// The row's `result` is now exactly the declared fields:
//   open-ended  (requestShape 'open-ended', one text field — `query`'s `response`)
//               → { <that field>: the model's text }
//   structured  → the model's text parsed as a JSON object, keeping the declared fields.
//               A structured answer that is not such a document produced nothing the
//               capability promises, so the job FAILS and says why — where it used to
//               land DONE and fail later, inside the write-back.
// `model` is provenance, not part of what the work produces; it goes to its own column.

const { CAPABILITIES_DOC } = require('../docs');

const byId = new Map(CAPABILITIES_DOC.capabilities.map((c) => [c.id, c]));

/* An open-ended capability resolves to its one prose field, or the projection above
   has nothing honest to put the text in. Checked at load, so a declaration that breaks
   it stops the boot rather than mis-filing results. */
for (const c of byId.values()) {
  if (c.requestShape === 'open-ended' && !(Array.isArray(c.resolves) && c.resolves.length === 1
      && ['text', 'string'].includes(c.resolves[0].type))) {
    throw new Error(`lazuros: '${c.id}' is open-ended, so it must resolve to exactly one text field`);
  }
}

/**
 * @param {string} capabilityId
 * @param {unknown} answer what the worker posted as `result`
 * @returns {{ ok: true, result: object|null, model: string|null } | { ok: false, error: string, model: string|null }}
 */
function projectResult(capabilityId, answer) {
  const cap = byId.get(capabilityId);
  const model = answer && typeof answer === 'object' && typeof answer.model === 'string' ? answer.model : null;
  if (!cap || !Array.isArray(cap.resolves)) return { ok: true, result: answer ?? null, model };
  const names = cap.resolves.map((f) => f.name);

  let doc;
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && !('response' in answer)) {
    doc = answer;                                             // a worker that structured it itself
  } else {
    const text = answer && typeof answer === 'object' ? answer.response : answer;
    if (typeof text !== 'string') return { ok: false, error: 'the worker answered no response text', model };
    if (cap.requestShape === 'open-ended') return { ok: true, result: { [names[0]]: text }, model };
    try { doc = JSON.parse(text); } catch {
      return { ok: false, error: `the model's answer was not a JSON document; '${cap.id}' resolves to { ${names.join(', ')} }`, model };
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: `the model's answer was not a JSON object; '${cap.id}' resolves to { ${names.join(', ')} }`, model };
  }
  const result = {};
  for (const n of names) if (n in doc) result[n] = doc[n];
  if (!Object.keys(result).length) {
    return { ok: false, error: `the model's document carries none of { ${names.join(', ')} }`, model };
  }
  return { ok: true, result, model };
}

module.exports = { projectResult };
