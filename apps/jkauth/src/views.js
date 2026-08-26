'use strict'
// Server-rendered HTML: the shared shell, the login/register card, and the jkOS
// portal dashboard (app launcher + account + suite-wide AI controls).

const { GUEST_PASSWORD } = require('./config')
const { escHtml } = require('./util')

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — jkOS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,600;9..144,0,700;9..144,1,400;9..144,1,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`
}

function loginPage(opts = {}) {
  const { error, redirectTo, mode } = opts
  const redirectInput = redirectTo ? `<input type="hidden" name="redirect_to" value="${escHtml(redirectTo)}">` : ''
  const errorHtml = error ? `<p class="error">${escHtml(error)}</p>` : ''
  const guestEnabled = !!GUEST_PASSWORD
  const isRegister = mode === 'register'

  return layout(isRegister ? 'Register' : 'Sign in', `
<div class="card ink-in">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">${isRegister ? 'Create your account' : 'Sign in to your workspace'}</p>
  ${errorHtml}
  <form method="POST" action="${isRegister ? '/auth/register' : '/auth/login'}">
    ${redirectInput}
    ${isRegister ? '<input class="jk-field" type="text" id="name" name="name" placeholder="Your name" required autocomplete="name">' : ''}
    <input class="jk-field" type="email" id="email" name="email" placeholder="Email" required autocomplete="username" autocapitalize="none" spellcheck="false">
    <input class="jk-field" type="password" id="password" name="password" placeholder="Password" required autocomplete="${isRegister ? 'new-password' : 'current-password'}">
    ${!isRegister ? `<label class="remember-row"><input class="jk-field-check" type="checkbox" name="remember_me" value="1" checked> Remember me for 30 days</label>` : ''}
    <button type="submit" class="btn-primary">${isRegister ? 'Create account' : 'Sign in'}</button>
  </form>
  ${!isRegister && guestEnabled ? `<form method="POST" action="/auth/guest">${redirectInput}<button type="submit" class="btn-ghost">Continue as guest</button></form>` : ''}
  <p class="toggle">${isRegister
    ? `Already have an account? <a href="/auth/login${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}">Sign in</a>`
    : `No account? <a href="/auth/register${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}">Register</a>`
  }</p>
</div>`)
}

// Two-step verification challenge — rendered after a password login passes for
// an account with 2FA enabled. Carries the stateless pending token; the single
// code field accepts a TOTP, a recovery code, or the emailed OTP. (U6)
function twoFactorPage(opts = {}) {
  const { pendingToken, methods = [], redirectTo, error } = opts
  const errorHtml = error ? `<p class="error">${escHtml(error)}</p>` : ''
  const hasTotp = methods.includes('totp')
  const hasEmail = methods.includes('email')
  const hint = hasTotp && hasEmail
    ? 'Enter the code from your authenticator app, or the code we just emailed you.'
    : hasEmail ? 'We emailed you a 6-digit code. Enter it below to continue.'
    : 'Enter the 6-digit code from your authenticator app.'
  const recovery = hasTotp
    ? `<p class="toggle">Lost your device? Enter one of your recovery codes above.</p>` : ''
  const backHref = `/auth/login${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}`
  return layout('Verify', `
<div class="card ink-in">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">Two-step verification</p>
  ${errorHtml}
  <p class="muted-note" style="margin:-.3rem 0 .2rem">${escHtml(hint)}</p>
  <form method="POST" action="/auth/login/2fa">
    <input type="hidden" name="pending_token" value="${escHtml(pendingToken)}">
    <input class="jk-field" type="text" name="code" inputmode="numeric" autocomplete="one-time-code"
      placeholder="Verification code" required autofocus spellcheck="false">
    <button type="submit" class="btn-primary">Verify</button>
  </form>
  ${recovery}
  <p class="toggle"><a href="${backHref}">Back to sign in</a></p>
</div>`)
}

// Account security page (authenticated) — manage TOTP + email 2FA. Pure forms,
// so it needs no client JS and stays within the strict CSP. (U6)
function securityPage(user, info = {}, opts = {}) {
  const { totpEnabled, emailEnabled, recoveryRemaining } = info
  const { notice, error } = opts
  const noticeHtml = notice ? `<p class="ok-note">${escHtml(notice)}</p>` : ''
  const errorHtml = error ? `<p class="error">${escHtml(error)}</p>` : ''

  const totpBlock = totpEnabled
    ? `<p class="muted-note">Authenticator app is <strong>on</strong>. Recovery codes left: ${recoveryRemaining}.</p>
       <form method="POST" action="/auth/2fa/totp/disable"><button class="btn-ghost">Turn off authenticator</button></form>`
    : `<p class="muted-note">Use an authenticator app (Google Authenticator, 1Password, …) for time-based codes.</p>
       <form method="POST" action="/auth/2fa/totp/setup"><button class="btn-primary">Set up authenticator</button></form>`

  const emailBlock = emailEnabled
    ? `<p class="muted-note">Email codes are <strong>on</strong> — sent to ${escHtml(user.email)} at sign-in.</p>
       <form method="POST" action="/auth/2fa/email/disable"><button class="btn-ghost">Turn off email codes</button></form>`
    : `<p class="muted-note">Get a one-time code by email at each sign-in.</p>
       <form method="POST" action="/auth/2fa/email/enable"><button class="btn-primary">Turn on email codes</button></form>`

  return layout('Security', `
<div class="card ink-in" style="max-width:460px">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">Account security · ${escHtml(user.email)}</p>
  ${noticeHtml}${errorHtml}
  <div class="sec-section">
    <h2>Authenticator app (TOTP)</h2>
    ${totpBlock}
  </div>
  <div class="sec-section">
    <h2>Email codes</h2>
    ${emailBlock}
  </div>
  <p class="toggle"><a href="/auth/dashboard">Back to portal</a></p>
</div>`)
}

// Shown right after starting TOTP setup: the QR + secret, and a field to confirm
// the first code (which enables it). (U6)
function totpSetupPage(opts = {}) {
  const { qr, secret, error } = opts
  const errorHtml = error ? `<p class="error">${escHtml(error)}</p>` : ''
  return layout('Set up authenticator', `
<div class="card ink-in" style="max-width:460px">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">Scan, then enter a code to confirm</p>
  ${errorHtml}
  <img src="${escHtml(qr)}" alt="Authenticator QR code" width="200" height="200"
    style="display:block;margin:.5rem auto;border-radius:8px;background:#fff;padding:6px">
  <p class="muted-note" style="text-align:center">Can't scan? Enter this key manually:</p>
  <p class="secret-key">${escHtml(secret)}</p>
  <form method="POST" action="/auth/2fa/totp/enable">
    <input class="jk-field" type="text" name="code" inputmode="numeric" autocomplete="one-time-code"
      placeholder="6-digit code" required autofocus spellcheck="false">
    <button type="submit" class="btn-primary">Confirm &amp; enable</button>
  </form>
  <p class="toggle"><a href="/auth/security">Cancel</a></p>
</div>`)
}

// Shown once after TOTP is enabled — the recovery codes. The user must save them.
function recoveryCodesPage(codes = []) {
  const list = codes.map(c => `<li>${escHtml(c)}</li>`).join('')
  return layout('Recovery codes', `
<div class="card ink-in" style="max-width:460px">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">Save your recovery codes</p>
  <p class="muted-note">Each works once if you lose your authenticator. Store them somewhere safe — they won't be shown again.</p>
  <ul class="recovery-list">${list}</ul>
  <p class="toggle"><a href="/auth/security">Done — I've saved them</a></p>
</div>`)
}

// jkOS portal — shown when a user navigates to jkAuth directly (vs. being
// bounced here to sign in for a specific app). App launcher + account + the
// suite-wide AI (LazurOS) controls. Interactive bits read/write /auth/profile.
function dashboardPage(user, nonce = '') {
  const src = (user.name || user.email || '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()
  const roleBadge = user.role && user.role !== 'user'
    ? `<span class="role">${escHtml(user.role)}</span>` : ''

  return layout('Portal', `
<style nonce="${nonce}">
  body { display:block; align-items:initial; justify-content:initial; }
  .dash { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; display:flex; flex-direction:column; gap: 1.75rem; }
  .dash-top { display:flex; align-items:center; gap: 1rem; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; flex-shrink:0; display:grid; place-items:center;
    background: var(--accent); color:var(--color-on-accent); font-weight:700; font-size: 1rem; }
  .who { min-width:0; flex:1; }
  .who h1 { font-size: 1.15rem; font-weight: 700; letter-spacing:-0.01em; display:flex; align-items:center; gap:.5rem; }
  .who .email { color: var(--muted); font-size: .85rem; margin-top: 2px; }
  .role { font-size: .6rem; letter-spacing:.12em; text-transform:uppercase; color:var(--color-on-accent); background:var(--accent);
    padding: 2px 7px; border-radius: 999px; font-weight:600; }
  .dash-actions { margin-left:auto; display:flex; gap:.5rem; align-items:center; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.25rem 1.4rem; }
  .panel > h2 { font-size: .7rem; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 1rem; }
  .apps { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: .7rem; }
  .app { display:flex; align-items:center; gap:.7rem; padding:.8rem .9rem; border:1px solid var(--border); border-radius:10px;
    text-decoration:none; color:var(--text); background:var(--bg); transition: border-color .15s, transform .15s; }
  .app:hover { border-color: var(--accent); transform: translateY(-1px); }
  .app .ic { width:30px; height:30px; border-radius:8px; flex-shrink:0; display:grid; place-items:center;
    background: var(--accent); color:var(--color-on-accent); font-weight:700; font-size:.85rem; }
  .app .nm { font-weight:600; font-size:.9rem; }
  .muted-note { color: var(--muted); font-size: .85rem; }
  .ai-head { display:flex; align-items:center; justify-content:space-between; margin-bottom: .25rem; }
  .ai-head h2 { margin-bottom: 0; }
  .switch { width: 46px; height: 26px; border-radius: 999px; border:1px solid var(--border); background:var(--hub-bg-0);
    position:relative; cursor:pointer; transition: background .18s; flex-shrink:0; }
  .switch[aria-checked=true] { background: var(--accent); border-color: var(--accent); }
  .switch .knob { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:var(--hub-bg-2);
    transition: left .18s; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .switch[aria-checked=true] .knob { left: 22px; }
  .ai-status { font-size:.8rem; color: var(--muted); margin-top:.6rem; min-height: 1em; }
</style>
<div class="dash">
  <div class="dash-top">
    <div class="avatar">${escHtml(inits)}</div>
    <div class="who">
      <h1>${escHtml(user.name || 'jkOS User')} ${roleBadge}</h1>
      <div class="email">${escHtml(user.email)}</div>
    </div>
    <div class="dash-actions">
      <a href="/auth/security" class="btn-ghost" style="width:auto;padding:.5rem .9rem;text-decoration:none;">Security</a>
      <form method="POST" action="/auth/logout">
        <button type="submit" class="btn-ghost" style="width:auto;padding:.5rem .9rem;">Sign out</button>
      </form>
    </div>
  </div>

  <section class="panel">
    <h2>Your apps</h2>
    <div class="apps" id="apps"><div class="muted-note">Loading…</div></div>
  </section>

  <section class="panel">
    <div class="ai-head">
      <h2>AI · LazurOS</h2>
      <div class="switch" id="ai-switch" role="switch" aria-checked="true" tabindex="0" title="Turn AI on/off across the suite">
        <span class="knob"></span>
      </div>
    </div>
    <p class="muted-note">One switch for AI across every jkOS app. Off hides LazurOS everywhere.
      There is nothing else to configure: the gateway is reached at a fixed suite path, and
      each tier picks its own model from the deployment config on the machine that runs it.</p>
    <div class="ai-status" id="ai-status"></div>
  </section>
</div>

<script nonce="${nonce}">
'use strict';
const ROLE = ${JSON.stringify(user.role || 'user')};

// App launcher — registered apps this role may use (exclude jkAuth itself, and
// origin-less rows like the LazurOS gateway which has no browsable launcher tile).
fetch('/auth/apps', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : { apps: [] })
  .then(({ apps }) => {
    const el = document.getElementById('apps');
    const list = (apps || []).filter(a =>
      a.id !== 'auth' && a.origin && (a.allowed_roles || '').split(',').map(s => s.trim()).includes(ROLE));
    if (!list.length) { el.innerHTML = '<div class="muted-note">No apps available for your account.</div>'; return; }
    el.innerHTML = list.map(a => {
      const ic = (a.name || '?').trim()[0].toUpperCase();
      return '<a class="app" href="' + a.origin + '"><span class="ic">' + ic + '</span><span class="nm">' + a.name + '</span></a>';
    }).join('');
  })
  .catch(() => { document.getElementById('apps').innerHTML = '<div class="muted-note">Could not load apps.</div>'; });

// The AI kill switch — the ONE preference LazurOS has, owned here. Every other app
// reads preferences.lazuros.enabled and hides its AI surfaces; none of them writes it.
const sw = document.getElementById('ai-switch');
const status = document.getElementById('ai-status');
let lazuros = { enabled: true };

function paint() { sw.setAttribute('aria-checked', String(!!lazuros.enabled)); }
function save() {
  status.textContent = 'Saving…';
  fetch('/auth/profile', {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { lazuros } }),
  }).then(r => { status.textContent = r.ok ? 'Saved' : 'Save failed'; })
    .catch(() => { status.textContent = 'Save failed'; });
}

fetch('/auth/profile', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : null)
  .then(p => { if (p && p.preferences && p.preferences.lazuros) lazuros = { enabled: p.preferences.lazuros.enabled !== false };
    paint(); })
  .catch(() => {});

sw.addEventListener('click', () => { lazuros.enabled = !lazuros.enabled; paint(); save(); });
sw.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); sw.click(); } });
</script>`)
}

module.exports = {
  layout, loginPage, dashboardPage,
  twoFactorPage, securityPage, totpSetupPage, recoveryCodesPage,
}
