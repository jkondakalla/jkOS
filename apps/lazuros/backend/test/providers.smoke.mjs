// providers.smoke.mjs — Phase 3 Tier-0 providers, exercised against a mocked global
// fetch (no whisper/piper/Ollama runtime needed). Asserts each factory builds the
// right request and parses the right response behind its contract shape, plus the
// standardized pathing contract (lib/http): baseUrl validated at boot, trailing
// slash stripped, every outbound call under a timeout signal. Run via the package
// `test` script (chained after queue.smoke).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { createOllamaInferenceProvider } = require('../providers/inference');
const { createWhisperSttProvider, createCloudSttProvider } = require('../providers/stt');
const { createPiperTtsProvider, createKokoroTtsProvider, createCloudTtsProvider } = require('../providers/tts');
const { createLocalEmbeddingProvider } = require('../providers/embedding');
const { createSearxngWebSearchProvider, createDdgsWebSearchProvider } = require('../providers/webSearch');
const { createWolBackend } = require('../providers/computeBackend');
const { validateDeploymentConfig } = require('../lib/loadDeployment');

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAZUROS_ROOT = join(__dirname, '..', '..'); // test/ -> backend/ -> apps/lazuros/

let calls = [];
const ok = (body, { headers = {}, json } = {}) => ({
  ok: true, status: 200,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => json,
  arrayBuffer: async () => (typeof body === 'string' ? Buffer.from(body) : body),
});
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
}

let n = 0;
const test = (label, fn) => { fn(); n++; };

// ── STT (whisper, local) ────────────────────────────────────────────────────────
await (async () => {
  mockFetch(() => ok(null, { json: { text: 'buy milk', language: 'en' } }));
  const stt = createWhisperSttProvider({ baseUrl: 'http://localhost:8000/', model: 'base' });
  const out = await stt.transcribe(Buffer.from('FAKEWAV'), { language: 'en' });
  test('whisper hits /v1/audio/transcriptions', () =>
    assert.equal(calls[0].url, 'http://localhost:8000/v1/audio/transcriptions'));
  test('whisper sends multipart FormData', () => assert.ok(calls[0].init.body instanceof FormData));
  test('whisper forwards model + language fields', () => {
    assert.equal(calls[0].init.body.get('model'), 'base');
    assert.equal(calls[0].init.body.get('language'), 'en');
  });
  test('whisper parses { text, language }', () =>
    assert.deepEqual(out, { text: 'buy milk', language: 'en' }));
})();

test('whisper without baseUrl fails at BOOT (factory), not at request time', () =>
  assert.throws(() => createWhisperSttProvider({ model: 'base' }), /no baseUrl configured/));
test('a malformed baseUrl fails at boot with the slot name', () =>
  assert.throws(() => createOllamaInferenceProvider({ baseUrl: 'not a url' }),
    /InferenceProvider "ollama": invalid baseUrl/));

await (async () => {
  mockFetch(() => ok(null, { json: { text: 'hi' } }));
  const stt = createCloudSttProvider({ baseUrl: 'https://api.example.com', apiKey: 'sk-1' });
  await stt.transcribe(Buffer.from('x'));
  test('cloud stt sends bearer auth', () =>
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-1'));
})();

// ── TTS (piper native + openai-speech) ──────────────────────────────────────────
await (async () => {
  mockFetch(() => ok('WAVBYTES', { headers: { 'content-type': 'audio/wav' } }));
  const tts = createPiperTtsProvider({ baseUrl: 'http://localhost:5000', voiceModel: 'glados' });
  const out = await tts.synthesize('hello');
  test('piper POSTs to its native baseUrl', () => assert.equal(calls[0].url, 'http://localhost:5000'));
  test('piper sends { text, voice }', () =>
    assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'hello', voice: 'glados' }));
  test('piper returns { audioBuffer, mimeType }', () => {
    assert.ok(Buffer.isBuffer(out.audioBuffer));
    assert.equal(out.mimeType, 'audio/wav');
  });
})();

await (async () => {
  mockFetch(() => ok('MP3BYTES', { headers: { 'content-type': 'audio/mpeg' } }));
  const tts = createKokoroTtsProvider({ baseUrl: 'http://localhost:8880', voice: 'af_sky', model: 'kokoro' });
  await tts.synthesize('hello');
  test('kokoro hits /v1/audio/speech', () =>
    assert.equal(calls[0].url, 'http://localhost:8880/v1/audio/speech'));
  test('kokoro sends { model, input, voice }', () =>
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'kokoro', input: 'hello', voice: 'af_sky' }));
})();

await (async () => {
  mockFetch(() => ok('X', { headers: { 'content-type': 'audio/mpeg' } }));
  const tts = createCloudTtsProvider({ baseUrl: 'https://api.example.com', apiKey: 'sk-9', voice: 'nova' });
  await tts.synthesize('hi');
  test('cloud tts sends bearer auth to /v1/audio/speech', () => {
    assert.equal(calls[0].url, 'https://api.example.com/v1/audio/speech');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-9');
  });
})();

// ── Embedding (Ollama-compat) ────────────────────────────────────────────────────
test('embedding requires an explicit baseUrl (no hardcoded localhost)', () =>
  assert.throws(() => createLocalEmbeddingProvider({ model: 'bge' }), /no baseUrl configured/));

await (async () => {
  mockFetch(() => ok(null, { json: { embedding: [0.1, 0.2, 0.3] } }));
  const emb = createLocalEmbeddingProvider({ model: 'bge-small-en-v1.5', baseUrl: 'http://localhost:11434/' });
  const vec = await emb.embed('hello world');
  test('embedding hits /api/embeddings off a normalized base', () =>
    assert.equal(calls[0].url, 'http://localhost:11434/api/embeddings'));
  test('embedding sends { model, prompt }', () =>
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'bge-small-en-v1.5', prompt: 'hello world' }));
  test('embedding returns the vector', () => assert.deepEqual(vec, [0.1, 0.2, 0.3]));
  test('embedding declares dimensions for table sizing', () => assert.equal(emb.dimensions, 384));
})();

// ── error propagation (uniform lib/http shapes) ───────────────────────────────────
await (async () => {
  mockFetch(() => ({ ok: false, status: 503, headers: { get: () => null } }));
  const emb = createLocalEmbeddingProvider({ model: 'bge', baseUrl: 'http://localhost:11434' });
  await assert.rejects(() => emb.embed('x'), /failed: 503/);
  test('embedding surfaces a non-200 as "<what> failed: <status>"', () => {});
})();

await (async () => {
  mockFetch(() => { throw Object.assign(new Error('boom'), { name: 'TypeError' }); });
  const emb = createLocalEmbeddingProvider({ model: 'bge', baseUrl: 'http://localhost:11434' });
  await assert.rejects(() => emb.embed('x'), /embedding "bge" unreachable: boom/);
  test('a transport error surfaces as "<what> unreachable: <cause>"', () => {});
})();

// ── Web search (Tier 1) ───────────────────────────────────────────────────────────
await (async () => {
  mockFetch(() => ok(null, { json: { results: [
    { title: 'A', url: 'http://a', content: 'snip-a' },
    { title: 'B', url: 'http://b', content: 'snip-b' },
  ] } }));
  const ws = createSearxngWebSearchProvider({ baseUrl: 'http://searx.local/' });
  const out = await ws.search('weather', { limit: 5 });
  test('searxng GETs /search?format=json', () => {
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, '/search');
    assert.equal(u.searchParams.get('q'), 'weather');
    assert.equal(u.searchParams.get('format'), 'json');
  });
  test('searxng normalizes content→snippet', () =>
    assert.deepEqual(out.results[0], { title: 'A', url: 'http://a', snippet: 'snip-a' }));
})();

await (async () => {
  mockFetch(() => ok(null, { json: { results: [{ title: 'D', href: 'http://d', body: 'snip-d' }] } }));
  const ws = createDdgsWebSearchProvider({ baseUrl: 'http://localhost:8001' });
  const out = await ws.search('news', { limit: 3 });
  test('ddgs forwards max_results', () =>
    assert.equal(new URL(calls[0].url).searchParams.get('max_results'), '3'));
  test('ddgs normalizes href→url, body→snippet', () =>
    assert.deepEqual(out.results[0], { title: 'D', url: 'http://d', snippet: 'snip-d' }));
})();

test('web search without baseUrl fails at boot (factory)', () =>
  assert.throws(() => createSearxngWebSearchProvider({}), /no baseUrl configured/));

// ── Inference + the shared pathing contract ─────────────────────────────────────────
await (async () => {
  mockFetch(() => ok(null, { json: { response: 'hi there' } }));
  const inf = createOllamaInferenceProvider({ baseUrl: 'http://gpu-node:11434/' }); // trailing slash
  const out = await inf.generate('m-tag', 'prompt');
  test('ollama joins /api/generate off a normalized base (trailing slash stripped)', () =>
    assert.equal(calls[0].url, 'http://gpu-node:11434/api/generate'));
  test('inference returns { text, model }', () =>
    assert.deepEqual(out, { text: 'hi there', model: 'm-tag' }));
  test('every outbound call carries a timeout AbortSignal', () =>
    assert.ok(calls[0].init.signal instanceof AbortSignal));
})();

// ── ComputeBackend (Tier-2 seam) pathing guards ─────────────────────────────────────
test('wol backend rejects a malformed healthUrl at boot', () =>
  assert.throws(() => createWolBackend({ id: 'emily', healthUrl: 'not a url' }),
    /ComputeBackend "emily" healthUrl: invalid baseUrl/));

await (async () => {
  const wol = createWolBackend({ id: 'emily', mac: 'TODO_EMILY_MAC', healthUrl: 'http://emily:11434/' });
  await assert.rejects(() => wol.wake(), /invalid mac "TODO_EMILY_MAC"/);
  test('a placeholder MAC fails the wake loudly instead of broadcasting junk', () => {});
})();

// ── Deployment config: the example must not be a trap ──────────────────────────────
// deployment.example.json is what a self-hoster copies to stand up a node (git history
// item 1.2). If it doesn't pass the same schema check loadDeployment.js runs at boot,
// it's a silent trap for the next person. Path resolved relative to this test file —
// never a hardcoded repo path.
test('deployment.example.json validates against validateDeploymentConfig', () => {
  const raw = readFileSync(join(LAZUROS_ROOT, 'deployment.example.json'), 'utf8');
  const cfg = JSON.parse(raw);
  assert.doesNotThrow(() => validateDeploymentConfig(cfg));
});

// deployment.jag.json's TODO_EMILY_MAC/TODO_EMILY_IP are unresolved-hardware placeholders,
// but validateDeploymentConfig only checks structure (tiers/computeBackends shape) — the
// MAC format is checked later, at WoL provider construction (see the placeholder-MAC test
// above), not here. So this file validates cleanly too; assert it as extra coverage of the
// multi-tier + wol shape the single-tier example doesn't exercise.
test('deployment.jag.json also validates (placeholders are hardware facts, not structural)', () => {
  const raw = readFileSync(join(LAZUROS_ROOT, 'deployment.jag.json'), 'utf8');
  const cfg = JSON.parse(raw);
  assert.doesNotThrow(() => validateDeploymentConfig(cfg));
});

console.log(`✅ ALL PASS: ${n} assertions (providers.smoke)`);
