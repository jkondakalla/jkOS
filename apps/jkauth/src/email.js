'use strict'
// Outbound email via Resend's REST API (plain fetch — no SDK dependency). Used
// for 2FA one-time codes (U6). If RESEND_API_KEY is unset the send is a no-op
// that logs instead of throwing, so local dev and the smoke test still exercise
// the surrounding flow; OTP_TEST_ECHO=1 additionally prints the code for tests.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const EMAIL_FROM = process.env.EMAIL_FROM || 'jkOS <noreply@jkos.net>'

async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    console.log(`[email:noop] to=${to} subject=${JSON.stringify(subject)} (RESEND_API_KEY unset)`)
    return { ok: false, skipped: true }
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`)
  }
  return { ok: true }
}

async function sendOtpEmail(to, code) {
  // Explicit, env-gated echo so the smoke test (no real mailbox) can read the code.
  if (process.env.OTP_TEST_ECHO === '1') console.log(`[otp-echo] ${to} ${code}`)
  const subject = 'Your jkOS sign-in code'
  const text =
    `Your jkOS verification code is ${code}\n\n` +
    `It expires in 10 minutes. If you didn't try to sign in, you can ignore this email.`
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px">` +
    `<h2 style="margin:0 0 8px">jkOS sign-in code</h2>` +
    `<p style="color:#555;margin:0 0 16px">Enter this code to finish signing in:</p>` +
    `<div style="font-size:30px;font-weight:700;letter-spacing:.18em;padding:14px 0">${code}</div>` +
    `<p style="color:#888;font-size:13px">It expires in 10 minutes. If you didn't try to sign in, ignore this email.</p>` +
    `</div>`
  return sendEmail({ to, subject, html, text })
}

module.exports = { sendEmail, sendOtpEmail }
