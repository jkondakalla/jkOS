// writeback.smoke.mjs — Phase 6 delegated write-back, with an injected fake
// weaveServerClient (no jkAuth, no BeigeBoard). Asserts the State node commits a DONE
// parse-task/breakdown-goal AS the acting user, skips review-first/non-write
// capabilities, and surfaces a bad model response. Run via the package `test` script.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runWriteback } = require('../lib/writeback');

let n = 0;
const test = (label, fn) => { fn(); n++; };

// A fake client factory recording (app, actingUser, path, body).
function spyClient() {
  const log = [];
  const makeClient = (app, opts) => ({
    post: async (path, body) => { log.push({ app, actingUser: opts.actingUser, path, body }); return { ok: true, status: 200 }; },
  });
  return { makeClient, log };
}

// 1. parse-task → delegated POST /import as the job's user, parsed from response JSON.
await (async () => {
  const { makeClient, log } = spyClient();
  const job = { id: 'j1', capability: 'parse-task', user_id: 'user-42' };
  const out = await runWriteback(job, { response: '{"items":[{"title":"Buy milk"}]}', model: 'm' }, { makeClient });
  test('parse-task writes back', () => assert.deepEqual(out, { written: true, app: 'beigeboard', status: 200 }));
  test('targets beigeboard /import', () => { assert.equal(log[0].app, 'beigeboard'); assert.equal(log[0].path, '/import'); });
  test('acts AS the job user (delegation WHO)', () => assert.equal(log[0].actingUser, 'user-42'));
  test('posts the parsed import doc', () => assert.deepEqual(log[0].body, { items: [{ title: 'Buy milk' }] }));
})();

// 2. breakdown-goal → also writes back.
await (async () => {
  const { makeClient, log } = spyClient();
  await runWriteback({ id: 'j2', capability: 'breakdown-goal', user_id: 'u' },
    { response: '{"items":[]}' }, { makeClient });
  test('breakdown-goal writes back to /import', () => assert.equal(log[0].path, '/import'));
})();

// 3. parse-document → review-first, never auto-written.
await (async () => {
  const { makeClient, log } = spyClient();
  const out = await runWriteback({ id: 'j3', capability: 'parse-document', user_id: 'u' },
    { response: '{"items":[]}' }, { makeClient });
  test('parse-document is skipped (review-first)', () => assert.deepEqual(out, { skipped: true }));
  test('parse-document makes no write call', () => assert.equal(log.length, 0));
})();

// 4. query → not a write capability.
await (async () => {
  const { makeClient } = spyClient();
  const out = await runWriteback({ id: 'j4', capability: 'query', user_id: 'u' }, { response: 'hi' }, { makeClient });
  test('query is skipped', () => assert.deepEqual(out, { skipped: true }));
})();

// 5. already-structured result (no `response` key) posts as-is.
await (async () => {
  const { makeClient, log } = spyClient();
  await runWriteback({ id: 'j5', capability: 'parse-task', user_id: 'u' }, { items: [{ title: 'x' }] }, { makeClient });
  test('structured result posts directly', () => assert.deepEqual(log[0].body, { items: [{ title: 'x' }] }));
})();

// 6. non-JSON model response → a clear write-back fault, not a silent pass.
await (async () => {
  const { makeClient } = spyClient();
  await assert.rejects(
    () => runWriteback({ id: 'j6', capability: 'parse-task', user_id: 'u' }, { response: 'not json' }, { makeClient }),
    /not valid JSON/);
  test('non-JSON response rejects', () => {});
})();

// 7. missing user_id → cannot act for anyone.
await (async () => {
  const { makeClient } = spyClient();
  await assert.rejects(
    () => runWriteback({ id: 'j7', capability: 'parse-task' }, { response: '{}' }, { makeClient }),
    /no user_id/);
  test('no user_id rejects', () => {});
})();

console.log(`✅ ALL PASS: ${n} assertions (writeback.smoke)`);
