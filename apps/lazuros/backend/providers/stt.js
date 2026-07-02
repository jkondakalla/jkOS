'use strict';
// stt.js — SttProvider reference implementations. Real as of Phase 3.
//
// Shape: { kind, transcribe(audioBuffer, opts) => Promise<{ text, language? }> }
//
// Both reference impls POST multipart audio to an OpenAI-compatible
// /v1/audio/transcriptions endpoint — the de-facto local-STT contract spoken by
// faster-whisper-server, speaches, LocalAI, whisper.cpp's server, and OpenAI cloud
// alike. The only thing that differs between the local (`whisper`) and `cloud` factory
// is the auth header and where `baseUrl` points; the router calling stt.transcribe(buf)
// never knows or cares which it got. The runtime itself is deployment config, not code.
//
// Input contract (standardized): `baseUrl` is the ONE address field — validated at
// boot by normalizeBaseUrl, no `endpoint` alias. Optional `timeoutMs` per slot.

const { normalizeBaseUrl, providerFetch } = require('../lib/http');

function makeTranscribe({ base, apiKey, model, timeoutMs }) {
  return async (audioBuffer, opts = {}) => {
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: opts.mimeType || 'audio/wav' }),
      opts.filename || 'audio.wav');
    if (model) form.append('model', model);
    if (opts.language) form.append('language', opts.language);

    const r = await providerFetch('stt transcribe', `${base}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form,
    }, { timeoutMs });
    const data = await r.json();
    return { text: data.text ?? '', language: data.language };
  };
}

function createWhisperSttProvider({ baseUrl, model, runtime, timeoutMs = 60_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl, 'SttProvider "whisper"');
  return { kind: 'whisper', model, runtime, transcribe: makeTranscribe({ base, model, timeoutMs }) };
}

function createCloudSttProvider({ baseUrl, apiKey, model, timeoutMs = 60_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl, 'SttProvider "cloud"');
  return { kind: 'cloud', model, transcribe: makeTranscribe({ base, apiKey, model, timeoutMs }) };
}

module.exports = { createWhisperSttProvider, createCloudSttProvider };
