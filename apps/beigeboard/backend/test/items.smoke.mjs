// Integration smoke test for BeigeBoard direct item CRUD — the untested twin of
// import.smoke. Where import.smoke drives the single-user bulk path under the weave
// dev-stub, this one boots server.js with a REAL verifying key so it can forge
// distinct identities (two humans + a service token) and exercise the multi-user
// contract: per-user scoping, parent ownership + cycle rejection, cascade delete,
// the reserved-source write guard (BUG-1), and the no-seed-for-service rule (BUG-1).
//
// Wave 2 added the contract-truth coverage:
//   • BUG-3 — cap/date parity: oversized title + impossible date/time → 400 on direct
//     POST, while import still warns-and-truncates (the cap VALUE is shared, not the
//     behaviour).
//   • BUG-6.2 — OAuth callback is a public path: a cookie-less popup gets the
//     postMessage error contract, not a bare 401 page.
//   • L — the retired /api/ai/* chat-proxy surface stays retired (404).
//
//   node apps/beigeboard/backend/test/items.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
// Claimed in the suite-manifest port registry ('beigeboard:items.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3988;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'beigeboard';
const ISSUER = 'jkos-auth';

const tmp = mkdtempSync(join(tmpdir(), 'bb-items-'));
const DB_PATH = join(tmp, 'test.db');

// ── Forge suite tokens: RS256 over a throwaway keypair the server is told to trust.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mkToken(claims) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: '1' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, ...claims }));
  const input = `${header}.${payload}`;
  const sig = b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey));
  return `${input}.${sig}`;
}
const A   = mkToken({ sub: 101, role: 'admin', scope: ['beigeboard:write'] });
const B   = mkToken({ sub: 202, role: 'admin', scope: ['beigeboard:write'] });
const SVC = mkToken({ sub: 'svc:prober', typ: 'service', scope: ['beigeboard:write'] });

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}
const list = async (token, qs = '') => (await req('GET', '/api/items' + qs, undefined, token)).json || [];

async function waitForHealth(ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited) return false; // the child is gone — polling the port can only find a stranger
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.service === SERVICE) return true;
        console.error(`  ✗ /health answered 200 but service=${JSON.stringify(body.service)} — ` +
                      `expected '${SERVICE}'. Another server owns this port.`);
        return false;
      }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH,
    JKOS_AUTH_PUBLIC_KEY: publicKey, JKOS_AUTH_ISSUER: ISSUER,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let exited = null; // fail fast: a child that dies pre-health must not be polled for
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });
child.on('exit', (code, signal) => { exited = { code, signal }; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  // The child's own words, on ANY failure — not only when health never came up.
  if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\nitems.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '')
      + ':\n' + serverLog);
    done();
  }

  // ── auth sanity: no token → 401 (the real key is enforced, not the dev stub) ──
  const anon = await req('GET', '/api/items');
  ok(anon.status === 401, `auth: unauthenticated GET → 401 (got ${anon.status})`);

  // ── A. reserved-source guard on direct POST (BUG-1) ──────────────────────────
  for (const src of ['google', 'outlook', 'icloud']) {
    const r = await req('POST', '/api/items', { title: `cal ${src}`, source: src }, A);
    ok(r.status === 400 && r.json?.code === 'VALIDATION',
      `A: POST source='${src}' → 400 VALIDATION (got ${r.status} ${JSON.stringify(r.json)})`);
  }
  const upper = await req('POST', '/api/items', { title: 'Cal Google', source: 'Google' }, A);
  ok(upper.status === 400, `A: reserved source match is case-insensitive (got ${upper.status})`);

  const allowed = await req('POST', '/api/items', { title: 'my own row', source: 'bb' }, A);
  ok(allowed.status === 201 && allowed.json?.source === 'bb', `A: source='bb' allowed (got ${allowed.status})`);
  const plain = await req('POST', '/api/items', { title: 'plain row' }, A);
  ok(plain.status === 201, `A: sourceless POST allowed (got ${plain.status})`);

  // ── B. reserved-source guard on direct PATCH (BUG-1) ─────────────────────────
  const patchG = await req('PATCH', `/api/items/${plain.json.id}`, { source: 'google' }, A);
  ok(patchG.status === 400 && patchG.json?.code === 'VALIDATION',
    `B: PATCH source='google' → 400 VALIDATION (got ${patchG.status})`);
  const plainAfter = (await list(A)).find(x => x.id === plain.json.id);
  ok(plainAfter && plainAfter.source !== 'google', 'B: rejected PATCH did not mutate the row');
  // a non-reserved PATCH alongside a title change still works
  const patchOk = await req('PATCH', `/api/items/${plain.json.id}`, { source: 'bb', title: 'renamed' }, A);
  ok(patchOk.status === 200 && patchOk.json?.title === 'renamed', `B: normal PATCH still works (got ${patchOk.status})`);

  // ── C. import keeps its warn-and-default behaviour (BUG-1 — not a hard error) ──
  const imp = await req('POST', '/api/import', { items: [{ title: 'imported cal', source: 'google', tags: ['resv'] }] }, A);
  ok(imp.status === 201, `C: import with reserved source still succeeds (got ${imp.status})`);
  const impRow = (await list(A, '?tags=resv'))[0];
  ok(impRow?.source === 'bb', `C: import defaulted reserved source to 'bb' (got ${impRow?.source})`);
  ok(Array.isArray(imp.json?.warnings) && imp.json.warnings.some(w => /reserved/.test(w)),
    'C: import surfaced a reserved-source warning');

  // ── D. service identity gets NO lazy demo-seed (BUG-1) ───────────────────────
  const svc1 = await req('GET', '/api/items', undefined, SVC);
  ok(svc1.status === 200 && Array.isArray(svc1.json) && svc1.json.length === 0,
    `D: service GET on empty account returns [] — no seed (got ${svc1.status}, len ${svc1.json?.length})`);
  const svc2 = await req('GET', '/api/items', undefined, SVC);
  ok((svc2.json || []).length === 0, 'D: repeat service GET still empty (nothing was seeded/persisted)');

  // ── E. a fresh HUMAN account IS seeded (positive control for D) ───────────────
  const bFirst = await list(B);
  ok(bFirst.length > 0, `E: fresh human account is lazily seeded (got ${bFirst.length} rows)`);

  // ── F. per-user isolation: B cannot see/patch/delete A's row ─────────────────
  const aSecret = await req('POST', '/api/items', { title: `A-secret-${Date.now()}` }, A);
  ok(aSecret.status === 201, `F: A creates a private row (got ${aSecret.status})`);
  const bView = await list(B);
  ok(!bView.some(x => x.id === aSecret.json.id), 'F: B does not see A\'s row');
  const bPatch = await req('PATCH', `/api/items/${aSecret.json.id}`, { title: 'hijacked' }, B);
  ok(bPatch.status === 404, `F: B PATCH of A's row → 404 (got ${bPatch.status})`);
  const bDel = await req('DELETE', `/api/items/${aSecret.json.id}`, undefined, B);
  ok(bDel.status === 404, `F: B DELETE of A's row → 404 (got ${bDel.status})`);
  const aStill = (await list(A)).find(x => x.id === aSecret.json.id);
  ok(aStill?.title === aSecret.json.title, 'F: A\'s row survived B\'s tampering attempts');

  // ── G. parent ownership + cycle rejection ────────────────────────────────────
  const bRow = (await list(B))[0];
  const crossParent = await req('POST', '/api/items', { title: 'orphan', parent_id: bRow.id }, A);
  ok(crossParent.status === 400, `G: cannot parent a new A row under a B row → 400 (got ${crossParent.status})`);

  const P = await req('POST', '/api/items', { title: 'parent P' }, A);
  const Cnode = await req('POST', '/api/items', { title: 'child C', parent_id: P.json.id }, A);
  ok(Cnode.status === 201 && Cnode.json?.parent_id === P.json.id, `G: child wires under parent (got ${Cnode.status})`);

  const selfP = await req('PATCH', `/api/items/${P.json.id}`, { parent_id: P.json.id }, A);
  ok(selfP.status === 400, `G: self-parent rejected → 400 (got ${selfP.status})`);
  const indirect = await req('PATCH', `/api/items/${P.json.id}`, { parent_id: Cnode.json.id }, A);
  ok(indirect.status === 400, `G: indirect cycle (P→C→P) rejected → 400 (got ${indirect.status})`);

  // ── H. cascade delete removes the whole subtree ──────────────────────────────
  const delP = await req('DELETE', `/api/items/${P.json.id}`, undefined, A);
  ok(delP.status === 200, `H: delete parent P → 200 (got ${delP.status})`);
  const aAll = await list(A);
  ok(!aAll.some(x => x.id === P.json.id) && !aAll.some(x => x.id === Cnode.json.id),
    'H: cascade delete removed both parent and child');

  // ── J. direct-write cap + date parity with import (BUG-3) ─────────────────────
  //     A direct API caller gets a HARD 400 where import warns-and-truncates; the
  //     shared thing is the cap VALUE (500) and the date validity, not the behaviour.
  const bigTitle = await req('POST', '/api/items', { title: 'x'.repeat(600) }, A);
  ok(bigTitle.status === 400 && bigTitle.json?.code === 'VALIDATION',
    `J: oversized title → 400 VALIDATION on direct POST (got ${bigTitle.status})`);
  const badDate = await req('POST', '/api/items', { title: 'bad date', due_date: '2026-13-45' }, A);
  ok(badDate.status === 400 && badDate.json?.code === 'VALIDATION',
    `J: impossible due_date → 400 VALIDATION (got ${badDate.status} ${JSON.stringify(badDate.json)})`);
  const badTime = await req('POST', '/api/items', { title: 'bad time', scheduled_time: '99:99' }, A);
  ok(badTime.status === 400 && badTime.json?.code === 'VALIDATION',
    `J: invalid scheduled_time → 400 VALIDATION (got ${badTime.status})`);
  const goodDate = await req('POST', '/api/items', { title: 'ok date', due_date: '2026-07-06', scheduled_time: '09:30' }, A);
  ok(goodDate.status === 201, `J: valid date/time still accepted (got ${goodDate.status})`);
  const badPatch = await req('PATCH', `/api/items/${goodDate.json.id}`, { title: 'z'.repeat(600) }, A);
  ok(badPatch.status === 400 && badPatch.json?.code === 'VALIDATION', `J: oversized title on PATCH → 400 (got ${badPatch.status})`);
  const impBig = await req('POST', '/api/import', { items: [{ title: 'y'.repeat(700), tags: ['bigimp'] }] }, A);
  ok(impBig.status === 201, `J: import still SUCCEEDS on an oversized title (warn+truncate, got ${impBig.status})`);
  const impBigRow = (await list(A, '?tags=bigimp'))[0];
  ok(impBigRow && impBigRow.title.length === 500, `J: import truncated the title to the shared 500 cap (got ${impBigRow?.title?.length})`);

  // ── K. OAuth callback is public — cookie-less popup gets postMessage error, not 401 (BUG-6.2)
  const cbAnon = await fetch(BASE + '/api/auth/google/callback?code=x&state=y');
  const cbAnonText = await cbAnon.text();
  ok(cbAnon.status === 200 && /google-auth-error/.test(cbAnonText),
    `K: cookie-less google callback → 200 postMessage error, not a bare 401 (got ${cbAnon.status})`);
  ok(/session expired/i.test(cbAnonText), 'K: cookie-less callback reports session expired');
  const cbOut = await fetch(BASE + '/api/auth/outlook/callback?code=x&state=y');
  const cbOutText = await cbOut.text();
  ok(cbOut.status === 200 && /outlook-auth-error/.test(cbOutText), `K: cookie-less outlook callback → 200 postMessage error (got ${cbOut.status})`);
  // A VALID token but no CSRF state cookie → optionalAuth populated req.user, the
  // handler runs AS the user and fails the state check (the flow is still CSRF-guarded).
  const cbAuthed = await fetch(BASE + '/api/auth/google/callback?code=x&state=y', { headers: { Authorization: `Bearer ${A}` } });
  const cbAuthedText = await cbAuthed.text();
  ok(cbAuthed.status === 200 && /Invalid state/.test(cbAuthedText),
    `K: authed callback w/o state cookie → 200 Invalid state (optionalAuth ran, CSRF held) (got ${cbAuthed.status})`);

  // ── M. started_at is WRITE-ONCE at the table (BB-11, migration 14). The column
  //    is client-written from the session UI, and an unguarded overwrite turns
  //    "when the session started" into "when it was last touched" — silently and
  //    unrepairably. The trigger preserves the first value and lets the rest of
  //    the PATCH through.
  const stamp1 = '2026-08-26T10:00:00.000Z';
  const mkM = await req('POST', '/api/items', { title: 'session', kind: 'task' }, A);
  ok(mkM.status === 201, `M: create for the write-once check (got ${mkM.status})`);
  const mId = mkM.json.id;
  let mp = await req('PATCH', `/api/items/${mId}`, { started_at: stamp1 }, A);
  ok(mp.status === 200, `M: first started_at write lands (got ${mp.status})`);
  mp = await req('PATCH', `/api/items/${mId}`, { started_at: '2026-08-26T11:30:00.000Z', title: 'renamed' }, A);
  const mRow = ((await req('GET', '/api/items', undefined, A)).json || []).find(r => r.id === mId);
  ok(mRow.started_at === stamp1, `M: a second started_at write is PRESERVED, not applied (got ${mRow.started_at})`);
  ok(mRow.title === 'renamed', 'M: the rest of that PATCH still applied');

  // ── N. items(parent_id) is indexed (BB-14) — every tree walk was a table scan.
  {
    const { default: Database } = await import('better-sqlite3');
    const idx = new Database(DB_PATH, { readonly: true })
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_items_parent'").get();
    ok(!!idx, 'N: idx_items_parent exists');
  }

  // ── L. No AI surface. BeigeBoard used to proxy a synchronous Ollama chat call at
  //    /api/ai/*; LazurOS is an async job gateway now, and it writes results back
  //    through /api/items as the acting user. The route is gone, so it must 404 —
  //    not linger as an unauthenticated hole or a half-wired stub.
  const aiGone = await req('POST', '/api/ai/parse-task', { text: 'lunch tomorrow' }, A);
  ok(aiGone.status === 404, `L: /api/ai/parse-task is gone → 404 (got ${aiGone.status})`);
  const bdGone = await req('POST', '/api/ai/breakdown', { title: 'ship it' }, A);
  ok(bdGone.status === 404, `L: /api/ai/breakdown is gone → 404 (got ${bdGone.status})`);

  // ── O. THE ACTIVITY CONTRACT (D6 / XC-2) ──────────────────────────────────────
  //    ⚠️ BeigeBoard's ledger is not a ledger table — it is `started_at` and
  //    `completed_at`, two columns on a wide items row (see src/item-fields.js). So
  //    unlike papyros's and kouros's, this app's read is a UNION, and ONE ITEM CAN
  //    PRODUCE TWO EVENTS. That is the part worth testing: an id collision between
  //    the two legs would make the merged cross-app feed drop one of them silently,
  //    because de-duplication is by event id.
  const oStart = '2026-08-26T09:00:00.000Z';
  const mkO = await req('POST', '/api/items', { title: 'activity subject', kind: 'task' }, A);
  const oId = mkO.json.id;
  await req('PATCH', `/api/items/${oId}`, { started_at: oStart }, A);
  await req('PATCH', `/api/items/${oId}`, { completed: true }, A);

  const anonAct = await req('GET', '/api/activity');
  ok(anonAct.status === 401, `O: unauthenticated GET /api/activity → 401 (got ${anonAct.status})`);

  const act = (await req('GET', '/api/activity', undefined, A)).json;
  ok(act?.app === 'beigeboard', `O: the doc names its app (got ${act?.app})`);
  ok(act?.kinds?.map((k) => k.id).sort().join(',') === 'complete,start',
    `O: BeigeBoard declares TWO verbs, not one (got ${JSON.stringify(act?.kinds?.map((k) => k.id))})`);

  const { checkActivityDoc } = await import('@jkos/weave/activity');
  ok(checkActivityDoc(act) === null, `O: the served doc satisfies the shared contract (${checkActivityDoc(act)})`);

  const mine = act.activity.filter((e) => e.ref === `beigeboard:${oId}`);
  ok(mine.length === 2, `O: one item that was started AND completed yields TWO events (got ${mine.length})`);
  ok(new Set(mine.map((e) => e.id)).size === 2,
    `O: the two events carry DISTINCT ids — a collision would silently drop one from the merged feed (got ${JSON.stringify(mine.map((e) => e.id))})`);
  const started = mine.find((e) => e.kind === 'start');
  const done = mine.find((e) => e.kind === 'complete');
  ok(started?.at === oStart, `O: the start event carries the write-once started_at (got ${started?.at})`);
  ok(done?.completed === true, `O: only the complete event asserts completion (got ${done?.completed})`);
  ok(started?.completed === null,
    `O: a start event is null, NOT false — "no notion of finishing", not "did not finish" (got ${started?.completed})`);
  ok(mine.every((e) => e.ms === null),
    'O: ms stays null — elapsed wall-clock is not "time actually spent", which is what ms means everywhere else');

  // The union windows BOTH legs. Filtering only one would silently return unbounded
  // rows from the other, which is the bug this shape invites.
  const wide = (await req('GET', '/api/activity?since=2026-08-26T08%3A00%3A00.000Z', undefined, A)).json;
  ok(wide.activity.every((e) => e.at > '2026-08-26T08:00:00.000Z'),
    'O: ?since= bounds BOTH legs of the union, not just the first');

  const actB = (await req('GET', '/api/activity', undefined, B)).json;
  ok(!actB.activity.some((e) => e.ref === `beigeboard:${oId}`), "O: A's events never appear in B's feed");

  // ── P. THE DEPENDENCY GRAPH (D12) ─────────────────────────────────────────
  //    ⭐ The one relationship a column could not express. `parent_id` says B is
  //    PART OF A; `position` says B comes AFTER A on a list; neither says B CANNOT
  //    START until A ships — which is the question a planner exists to answer.
  //    Decomposition is a tree, blocking is a DAG, and a row can be blocked by
  //    several things in different branches at once.
  const mkP = async (title) => (await req('POST', '/api/items', { title, kind: 'task' }, A)).json.id;
  const ship = await mkP('ship the API');
  const build = await mkP('build the UI');
  const launch = await mkP('launch');

  const link = await req('POST', `/api/items/${build}/deps`, { depends_on: ship }, A);
  ok(link.status === 201, `P: an edge can be added (got ${link.status})`);
  ok(link.json.blocked === true, 'P: the item reads as BLOCKED while its dependency is unfinished');
  ok(link.json.blocked_by.some((d) => d.id === ship), 'P: …and says what it is waiting on');

  const other = (await req('GET', `/api/items/${ship}/deps`, undefined, A)).json;
  ok(other.blocks.some((d) => d.id === build),
    'P: the reverse direction is readable — "what does finishing this unblock" is the reason to do it first');
  ok(other.blocked === false, 'P: an item with no dependencies is not blocked');

  // `blocked` is DERIVED, never stored — so completing the dependency clears it with
  // no write to the blocked row at all.
  await req('PATCH', `/api/items/${ship}`, { completed: true }, A);
  const cleared = (await req('GET', `/api/items/${build}/deps`, undefined, A)).json;
  ok(cleared.blocked === false,
    'P: completing the dependency unblocks it — `blocked` is derived on read, so nothing had to remember to update it');

  // ⚠️ THE CYCLE GUARD. A ring is not a cosmetic problem: "what is ready to start"
  //    is a walk over these edges, so a cycle either loops forever or quietly
  //    reports that nothing in the ring can ever start — a deadlock the user cannot
  //    see, because every individual edge looks sensible.
  await req('POST', `/api/items/${launch}/deps`, { depends_on: build }, A);
  const ring = await req('POST', `/api/items/${ship}/deps`, { depends_on: launch }, A);
  ok(ring.status === 400 && ring.json.code === 'CYCLE',
    `P: ⭐ an edge that would close a RING is refused (got ${ring.status} ${ring.json?.code})`);
  const selfDep = await req('POST', `/api/items/${ship}/deps`, { depends_on: ship }, A);
  ok(selfDep.status === 400 && selfDep.json.code === 'CYCLE', 'P: an item cannot depend on itself');

  // Ownership on BOTH ends — an edge is the one shape here that names a second row.
  const bItem = (await req('POST', '/api/items', { title: "B's thing", kind: 'task' }, B)).json.id;
  const cross = await req('POST', `/api/items/${build}/deps`, { depends_on: bItem }, A);
  ok(cross.status === 404, `P: an edge cannot reach another user's item (got ${cross.status})`);

  // ⚠️ DELETING AN ITEM SWEEPS ITS EDGES. item_deps carries no foreign key — on
  //    purpose, because items.parent_id carries none either — so nothing else would
  //    remove them, and a left-behind edge is not inert: it makes a live item
  //    permanently blocked by a row that no longer exists, which is
  //    indistinguishable from "still waiting" and impossible to clear from the UI.
  await req('DELETE', `/api/items/${build}`, undefined, A);
  const afterDel = (await req('GET', `/api/items/${launch}/deps`, undefined, A)).json;
  ok(!afterDel.blocked_by.some((d) => d.id === build),
    'P: ⭐ deleting an item sweeps the edges pointing at it — no permanent phantom block');
  ok(afterDel.blocked === false, 'P: …so the item that waited on it is free, not stuck forever');

  // ── Q. THE PLANNER'S MISSING FACTS (D12) ──────────────────────────────────
  const costed = await req('POST', '/api/items', {
    title: 'a costed task', kind: 'task', estimate_minutes: 90, defer_until: '2026-09-01',
  }, A);
  ok(costed.status === 201, `Q: estimate_minutes and defer_until are accepted (got ${costed.status})`);
  ok(costed.json.estimate_minutes === 90,
    `Q: estimate_minutes round-trips — the bench expressed commitment and nothing expressed COST, so nothing could say the week is overcommitted (got ${costed.json.estimate_minutes})`);
  ok(costed.json.defer_until === '2026-09-01',
    `Q: defer_until round-trips — distinct from due_date (when it must be done) and from parked status (got ${costed.json.defer_until})`);
} catch (e) {
  console.error('harness error:', e);
  fail++;
} finally {
  done();
}
