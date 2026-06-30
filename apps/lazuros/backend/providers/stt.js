'use strict';
// stt.js — SttProvider reference implementations. Real as of Phase 3.
//
// Shape: { transcribe(audioBuffer, opts) => Promise<{ text, language? }> }
//
// Both reference impls POST multipart audio to an OpenAI-compatible
// /v1/audio/transcriptions endpoint — the de-facto local-STT contract spoken by
// faster-whisper-server, speaches, LocalAI, whisper.cpp's server, and OpenAI cloud
// alike. The only thing that differs between the local (`whisper`) and `cloud` factory
// is the auth header and where `baseUrl` points; the router calling stt.transcribe(buf)
// never knows or cares which it got. The runtime itself is deployment config, not code.

async function transcribeOpenAICompat({ baseUrl, apiKey, model }, audioBuffer, opts = {}) {
  if (!baseUrl) throw new Error('SttProvider: no baseUrl configured — set deployment.stt.baseUrl');
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: opts.mimeType || 'audio/wav' }),
    opts.filename || 'audio.wav');
  if (model) form.append('model', model);
  if (opts.language) form.append('language', opts.language);

  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: form,
  });
  if (!r.ok) throw new Error(`stt transcribe failed: ${r.status}`);
  const data = await r.json();
  return { text: data.text ?? '', language: data.language };
}

function createWhisperSttProvider({ baseUrl, model, runtime } = {}) {
  return {
    kind: 'whisper', model, runtime,
    transcribe: (audioBuffer, opts) => transcribeOpenAICompat({ baseUrl, model }, audioBuffer, opts),
  };
}

function createCloudSttProvider({ endpoint, baseUrl, apiKey, model } = {}) {
  const url = baseUrl || endpoint;
  return {
    kind: 'cloud', endpoint: url, model,
    transcribe: (audioBuffer, opts) => transcribeOpenAICompat({ baseUrl: url, apiKey, model }, audioBuffer, opts),
  };
}

module.exports = { createWhisperSttProvider, createCloudSttProvider };
