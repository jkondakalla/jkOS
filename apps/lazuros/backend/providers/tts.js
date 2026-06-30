'use strict';
// tts.js — TtsProvider reference implementations. Real as of Phase 3.
//
// Shape: { synthesize(text, opts) => Promise<{ audioBuffer, mimeType }> }
//
// Piper speaks its own native HTTP server (POST { text } → WAV bytes). Kokoro and the
// generic `cloud` backend speak the OpenAI-compatible /v1/audio/speech contract
// (POST { model, input, voice } → audio bytes). Either way the caller gets the same
// { audioBuffer, mimeType } shape — the route code never branches on which engine ran.

async function fetchAudio(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`tts synthesize failed: ${r.status}`);
  const mimeType = r.headers.get('content-type') || 'audio/wav';
  return { audioBuffer: Buffer.from(await r.arrayBuffer()), mimeType };
}

// Kokoro + cloud share the OpenAI /v1/audio/speech contract; only auth + voice differ.
function synthesizeOpenAISpeech({ baseUrl, endpoint, apiKey, model, voice }, text, opts = {}) {
  const url = baseUrl || endpoint;
  if (!url) throw new Error('TtsProvider: no baseUrl configured — set deployment.tts.baseUrl');
  return fetchAudio(`${url.replace(/\/$/, '')}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model: model || 'tts-1', input: text, voice: opts.voice || voice }),
  });
}

function createPiperTtsProvider({ baseUrl, voiceModel } = {}) {
  return {
    kind: 'piper', voiceModel,
    synthesize: (text, opts = {}) => {
      if (!baseUrl) throw new Error('TtsProvider "piper": no baseUrl configured — set deployment.tts.baseUrl');
      return fetchAudio(baseUrl.replace(/\/$/, ''), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceModel, ...opts.body }),
      });
    },
  };
}

function createKokoroTtsProvider({ baseUrl, endpoint, apiKey, model, voice } = {}) {
  return {
    kind: 'kokoro', voice,
    synthesize: (text, opts) => synthesizeOpenAISpeech({ baseUrl, endpoint, apiKey, model, voice }, text, opts),
  };
}

function createCloudTtsProvider({ baseUrl, endpoint, apiKey, model, voice } = {}) {
  return {
    kind: 'cloud', voice,
    synthesize: (text, opts) => synthesizeOpenAISpeech({ baseUrl, endpoint, apiKey, model, voice }, text, opts),
  };
}

module.exports = { createPiperTtsProvider, createKokoroTtsProvider, createCloudTtsProvider };
