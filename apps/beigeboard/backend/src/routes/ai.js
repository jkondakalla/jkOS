'use strict';
// AI plumbing — the LazurOS chat call plus the two AI endpoints (free-text → task,
// goal → breakdown ladder). Both PARSE only; the caller writes the result.
const express = require('express');
const { LAZUROS_URL, LAZUROS_TOKEN, LAZUROS_DEFAULT_MODEL, BB_AI_ENABLED } = require('../config');
const { looksLikeDate, looksLikeTime, IMPORT_STR_CAP } = require('../schema');
const { fail } = require('../util');

const router = express.Router();

/* ── AI plumbing ───────────────────────────────────────────────────────────
   One place that talks to LazurOS's /api/chat and returns the model's JSON object.
   Both AI routes shared this fetch → ok-check → brace-extract → JSON.parse block
   verbatim (BUG-7 dedupe). Redacts the upstream error body — logs the detail, throws
   a generic reason — so a LazurOS stack/error body never reaches a browser (BUG-6.3).
   Throws an Error carrying { httpStatus, code } for the route to relay. */
async function lazurosChat(prompt) {
  const headers = { 'Content-Type': 'application/json' };
  if (LAZUROS_TOKEN) headers['Authorization'] = `Bearer ${LAZUROS_TOKEN}`;
  const r = await fetch(`${LAZUROS_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: LAZUROS_DEFAULT_MODEL,
      messages: [
        { role: 'system', content: 'You are a JSON API. Respond with a single valid JSON object only. No markdown, no explanation.' },
        { role: 'user',   content: prompt },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => String(r.status));
    console.error('[ai] LazurOS upstream error', r.status, detail);
    const e = new Error('The AI service is currently unavailable. Try again shortly.');
    e.httpStatus = 502; e.code = 'AI_UPSTREAM';
    throw e;
  }
  const data = await r.json();
  const raw  = data?.message?.content ?? '';
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) { const e = new Error('The AI returned no usable result.'); e.httpStatus = 502; e.code = 'AI_INVALID'; throw e; }
  try { return JSON.parse(raw.slice(start, end)); }
  catch { const e = new Error('The AI returned a malformed result.'); e.httpStatus = 502; e.code = 'AI_INVALID'; throw e; }
}

/* Whitelist the parse-task model reply to exactly the fields createItem accepts,
   applying the same caps/enums/date rules a direct write gets (BUG-7). A prompt-
   injected reply with extra keys, an oversized title, or a bad date is sanitised:
   unknown keys dropped, title capped, invalid date/time dropped. Returns the cleaned
   body, or null when the core is unusable (no title) so the route 422s instead of
   forwarding an injected object into createItem. */
function sanitizeParsedTask(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, IMPORT_STR_CAP.title) : '';
  if (!title) return null;
  const out = { title };
  if (parsed.kind != null)  { const k = String(parsed.kind).toLowerCase();  if (k === 'task' || k === 'event') out.kind = k; }
  if (parsed.scope != null) { const s = String(parsed.scope).toLowerCase(); if (s === 'day' || s === 'week' || s === 'month') out.scope = s; }
  if (parsed.due_date != null && parsed.due_date !== '') { const d = String(parsed.due_date).trim(); if (looksLikeDate(d)) out.due_date = d; }
  if (parsed.scheduled_time != null && parsed.scheduled_time !== '') { const t = String(parsed.scheduled_time).trim(); if (looksLikeTime(t)) out.scheduled_time = t; }
  if (parsed.notes != null && parsed.notes !== '') out.notes = String(parsed.notes).slice(0, IMPORT_STR_CAP.notes);
  return out;
}

/* ── AI: free text → structured task/event ─────────────────────────────── */
router.post('/api/ai/parse-task', async (req, res) => {
  if (!BB_AI_ENABLED) return res.status(503).json({ error: 'AI parsing is not enabled on this instance.' });
  try {
    const { text, today } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const trimmed = text.trim().slice(0, 500);

    // Ignore a malformed client `today` (would make an Invalid Date below → a 500
    // on .toISOString()); fall back to the server's date.
    const todayStr    = looksLikeDate(today) ? today.trim() : new Date().toISOString().split('T')[0];
    const d           = new Date(todayStr + 'T12:00:00');
    const tomorrowStr = new Date(d.getTime() + 86400000).toISOString().split('T')[0];
    const dayName     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];

    const prompt = `Parse this task or event description into structured JSON fields.

Description: "${trimmed}"

Context:
- Today is ${dayName} ${todayStr}
- Tomorrow is ${tomorrowStr}
- Resolve relative dates like "tomorrow", "friday", "next week" to YYYY-MM-DD

Return ONLY a JSON object with exactly these fields:
{
  "title": "clean title without date/time info",
  "kind": "task" or "event",
  "scope": "day" or "week" or "month",
  "due_date": "YYYY-MM-DD" or null,
  "scheduled_time": "HH:MM" (24h) or null,
  "notes": "extra context" or null
}`;

    let parsed;
    try { parsed = await lazurosChat(prompt); }
    catch (e) { return res.status(e.httpStatus || 502).json({ error: e.message, code: e.code || 'AI_UPSTREAM' }); }

    // Never forward the model's reply verbatim — a prompt-injected object could pour
    // extra keys / an oversized title / a bad date straight into createItem (BUG-7).
    // Whitelist to the declared parseTask fields, applying the direct-write rules.
    const clean = sanitizeParsedTask(parsed);
    if (!clean) return res.status(422).json({ error: 'The assistant could not produce a usable task from that text.', code: 'AI_INVALID' });
    res.json(clean);
  } catch (e) {
    console.error('[ai/parse-task]', e);
    fail(res, e);
  }
});

/* ── AI: draft a goal ladder (Breakdown Method step 2) ─────────────────── */
router.post('/api/ai/breakdown', async (req, res) => {
  if (!BB_AI_ENABLED) return res.status(503).json({ error: 'AI is not enabled on this instance.' });
  try {
    const { title, done_means, target_date } = req.body || {};
    if (!title?.toString().trim()) return res.status(400).json({ error: 'title is required' });

    const prompt = `You are helping break a long-term goal into checkpoints and first actions.

Goal: "${title.toString().slice(0, 200)}"
${done_means ? `Done means: "${done_means.toString().slice(0, 300)}"` : ''}
${target_date ? `Target date: ${target_date.toString().slice(0, 10)}` : ''}

Rules:
- 2 to 5 milestones: verifiable checkpoints in order, each provable when passed.
- 2 to 4 first_actions: concrete tasks toward ONLY the first milestone, each small enough to finish in one sitting.
- Plain language, no numbering in the text itself.

Return ONLY a JSON object: {"milestones": ["...", ...], "first_actions": ["...", ...]}`;

    let parsed;
    try { parsed = await lazurosChat(prompt); }
    catch (e) { return res.status(e.httpStatus || 502).json({ error: e.message, code: e.code || 'AI_UPSTREAM' }); }

    const clean = (arr, max) => (Array.isArray(arr) ? arr : [])
      .filter(s => typeof s === 'string' && s.trim())
      .map(s => s.trim().slice(0, 200))
      .slice(0, max);

    res.json({ milestones: clean(parsed.milestones, 5), first_actions: clean(parsed.first_actions, 4) });
  } catch (e) {
    console.error('[ai/breakdown]', e);
    fail(res, e);
  }
});

module.exports = { router, lazurosChat, sanitizeParsedTask };
