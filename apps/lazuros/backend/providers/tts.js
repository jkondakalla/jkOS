'use strict';
// tts.js — TtsProvider reference implementations. Real as of Phase 3.
//
// Shape: { kind, synthesize(text, opts) => Promise<{ audioBuffer, mimeType }> }
//
// Piper speaks its own native HTTP server (POST { text } → WAV bytes at the base URL).
// Kokoro and the generic `cloud` backend speak the OpenAI-compatible /v1/audio/speech
// contract (POST { model, input, voice } → audio bytes). Either way the caller gets the
// same { audioBuffer, mimeType } shape — the route code never branches on which engine
// ran.
//
// Input contract (standardized): `baseUrl` is the ONE address field — validated at
// boot by normalizeBaseUrl, no `endpoint` alias. Optional `timeoutMs` per slot.

const { normalizeBaseUrl, providerFetch } = require('../lib/http');

async function fetchAudio(url, init, timeoutMs) {
  const r = await providerFetch('tts synthesize', url, init, { timeoutMs });
  const mimeType = r.headers.get('content-type') || 'audio/wav';
  return { audioBuffer: Buffer.from(await r.arrayBuffer()), mimeType };
}

// Kokoro + cloud share the OpenAI /v1/audio/speech contract; only auth + voice differ.
function makeOpenAISpeech({ base, apiKey, model, voice, timeoutMs }) {
  return (text, opts = {}) => fetchAudio(`${base}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model: model || 'tts-1', input: text, voice: opts.voice || voice }),
  }, timeoutMs);
}

function createPiperTtsProvider({ baseUrl, voiceModel, timeoutMs = 60_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl, 'TtsProvider "piper"');
  return {
    kind: 'piper', voiceModel,
    synthesize: (text, opts = {}) => fetchAudio(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voiceModel, ...opts.body }),
    }, timeoutMs),
  };
}

function createKokoroTtsProvider({ baseUrl, apiKey, model, voice, timeoutMs = 60_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl, 'TtsProvider "kokoro"');
  return { kind: 'kokoro', voice, synthesize: makeOpenAISpeech({ base, apiKey, model, voice, timeoutMs }) };
}

function createCloudTtsProvider({ baseUrl, apiKey, model, voice, timeoutMs = 60_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl, 'TtsProvider "cloud"');
  return { kind: 'cloud', voice, synthesize: makeOpenAISpeech({ base, apiKey, model, voice, timeoutMs }) };
}

module.exports = { createPiperTtsProvider, createKokoroTtsProvider, createCloudTtsProvider };
