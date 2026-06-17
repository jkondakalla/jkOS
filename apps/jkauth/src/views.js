'use strict'
// Server-rendered HTML: the shared shell, the login/register card, and the jkOS
// portal dashboard (app launcher + account + suite-wide AI controls).

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GUEST_PASSWORD } = require('./config')
const { escHtml } = require('./util')

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — jkOS</title>
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
  const googleEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
  const guestEnabled = !!GUEST_PASSWORD
  const isRegister = mode === 'register'
  const googleHref = `/auth/google${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}`

  return layout(isRegister ? 'Register' : 'Sign in', `
<div class="card">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">${isRegister ? 'Create your account' : 'Sign in to your workspace'}</p>
  ${errorHtml}
  <form method="POST" action="${isRegister ? '/auth/register' : '/auth/login'}">
    ${redirectInput}
    ${isRegister ? '<input type="text" id="name" name="name" placeholder="Your name" required autocomplete="name">' : ''}
    <input type="email" id="email" name="email" placeholder="Email" required autocomplete="username" autocapitalize="none" spellcheck="false">
    <input type="password" id="password" name="password" placeholder="Password" required autocomplete="${isRegister ? 'new-password' : 'current-password'}">
    ${!isRegister ? `<label class="remember-row"><input type="checkbox" name="remember_me" value="1" checked> Remember me for 30 days</label>` : ''}
    <button type="submit" class="btn-primary">${isRegister ? 'Create account' : 'Sign in'}</button>
  </form>
  ${googleEnabled ? `<a href="${googleHref}" class="btn-google"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Continue with Google</a>` : ''}
  ${!isRegister && guestEnabled ? `<form method="POST" action="/auth/guest">${redirectInput}<button type="submit" class="btn-ghost">Continue as guest</button></form>` : ''}
  <p class="toggle">${isRegister
    ? `Already have an account? <a href="/auth/login${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}">Sign in</a>`
    : `No account? <a href="/auth/register${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}">Register</a>`
  }</p>
</div>`)
}

// jkOS portal — shown when a user navigates to jkAuth directly (vs. being
// bounced here to sign in for a specific app). App launcher + account + the
// suite-wide AI (LazurOS) controls. Interactive bits read/write /auth/profile.
function dashboardPage(user) {
  const src = (user.name || user.email || '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()
  const roleBadge = user.role && user.role !== 'user'
    ? `<span class="role">${escHtml(user.role)}</span>` : ''

  return layout('Portal', `
<style>
  body { display:block; align-items:initial; justify-content:initial; }
  .dash { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; display:flex; flex-direction:column; gap: 1.75rem; }
  .dash-top { display:flex; align-items:center; gap: 1rem; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; flex-shrink:0; display:grid; place-items:center;
    background: var(--accent); color:#fff; font-weight:700; font-size: 1rem; }
  .who { min-width:0; flex:1; }
  .who h1 { font-size: 1.15rem; font-weight: 700; letter-spacing:-0.01em; display:flex; align-items:center; gap:.5rem; }
  .who .email { color: var(--muted); font-size: .85rem; margin-top: 2px; }
  .role { font-size: .6rem; letter-spacing:.12em; text-transform:uppercase; color:#fff; background:var(--accent);
    padding: 2px 7px; border-radius: 999px; font-weight:600; }
  .sign-out { margin-left:auto; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.25rem 1.4rem; }
  .panel > h2 { font-size: .7rem; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 1rem; }
  .apps { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: .7rem; }
  .app { display:flex; align-items:center; gap:.7rem; padding:.8rem .9rem; border:1px solid var(--border); border-radius:10px;
    text-decoration:none; color:var(--text); background:var(--bg); transition: border-color .15s, transform .15s; }
  .app:hover { border-color: var(--accent); transform: translateY(-1px); }
  .app .ic { width:30px; height:30px; border-radius:8px; flex-shrink:0; display:grid; place-items:center;
    background: var(--accent); color:#fff; font-weight:700; font-size:.85rem; }
  .app .nm { font-weight:600; font-size:.9rem; }
  .muted-note { color: var(--muted); font-size: .85rem; }
  .row { display:flex; align-items:center; gap:.8rem; margin-top:.7rem; }
  .row label { width: 64px; flex-shrink:0; font-size:.82rem; color: var(--muted); }
  .row input[type=text] { flex:1; }
  .ai-head { display:flex; align-items:center; justify-content:space-between; margin-bottom: .25rem; }
  .ai-head h2 { margin-bottom: 0; }
  .switch { width: 46px; height: 26px; border-radius: 999px; border:1px solid var(--border); background:#ddd4cc;
    position:relative; cursor:pointer; transition: background .18s; flex-shrink:0; }
  .switch[aria-checked=true] { background: var(--accent); border-color: var(--accent); }
  .switch .knob { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff;
    transition: left .18s; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .switch[aria-checked=true] .knob { left: 22px; }
  .ai-body[data-off=true] { opacity:.45; pointer-events:none; }
  .ai-status { font-size:.8rem; color: var(--muted); margin-top:.6rem; min-height: 1em; }
</style>
<div class="dash">
  <div class="dash-top">
    <div class="avatar">${escHtml(inits)}</div>
    <div class="who">
      <h1>${escHtml(user.name || 'jkOS User')} ${roleBadge}</h1>
      <div class="email">${escHtml(user.email)}</div>
    </div>
    <form class="sign-out" method="POST" action="/auth/logout">
      <button type="submit" class="btn-ghost" style="width:auto;padding:.5rem .9rem;">Sign out</button>
    </form>
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
    <p class="muted-note">One switch for AI across every jkOS app. Off hides LazurOS everywhere.</p>
    <div class="ai-body" id="ai-body">
      <div class="row"><label for="ai-url">Gateway</label><input type="text" id="ai-url" placeholder="http://host:8080" spellcheck="false"></div>
      <div class="row"><label for="ai-model">Model</label><input type="text" id="ai-model" placeholder="llama3.2" spellcheck="false"></div>
    </div>
    <div class="ai-status" id="ai-status"></div>
  </section>
</div>

<script>
'use strict';
const ROLE = ${JSON.stringify(user.role || 'user')};

// App launcher — registered apps this role may use (exclude jkAuth itself).
fetch('/auth/apps', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : { apps: [] })
  .then(({ apps }) => {
    const el = document.getElementById('apps');
    const list = (apps || []).filter(a =>
      a.id !== 'auth' && (a.allowed_roles || '').split(',').map(s => s.trim()).includes(ROLE));
    if (!list.length) { el.innerHTML = '<div class="muted-note">No apps available for your account.</div>'; return; }
    el.innerHTML = list.map(a => {
      const ic = (a.name || '?').trim()[0].toUpperCase();
      return '<a class="app" href="' + a.origin + '"><span class="ic">' + ic + '</span><span class="nm">' + a.name + '</span></a>';
    }).join('');
  })
  .catch(() => { document.getElementById('apps').innerHTML = '<div class="muted-note">Could not load apps.</div>'; });

// AI controls — backed by /auth/profile preferences.lazuros.
const sw = document.getElementById('ai-switch');
const body = document.getElementById('ai-body');
const urlEl = document.getElementById('ai-url');
const modelEl = document.getElementById('ai-model');
const status = document.getElementById('ai-status');
let lazuros = { enabled: true, url: '', model: 'llama3.2' };
let saveTimer = null;

function paint() {
  sw.setAttribute('aria-checked', String(!!lazuros.enabled));
  body.setAttribute('data-off', String(!lazuros.enabled));
}
function save() {
  status.textContent = 'Saving…';
  fetch('/auth/profile', {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { lazuros } }),
  }).then(r => { status.textContent = r.ok ? 'Saved' : 'Save failed'; })
    .catch(() => { status.textContent = 'Save failed'; });
}
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }

fetch('/auth/profile', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : null)
  .then(p => { if (p && p.preferences && p.preferences.lazuros) lazuros = Object.assign(lazuros, p.preferences.lazuros);
    urlEl.value = lazuros.url || ''; modelEl.value = lazuros.model || ''; paint(); })
  .catch(() => {});

sw.addEventListener('click', () => { lazuros.enabled = !lazuros.enabled; paint(); save(); });
sw.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); sw.click(); } });
urlEl.addEventListener('change', () => { lazuros.url = urlEl.value.trim(); queueSave(); });
modelEl.addEventListener('change', () => { lazuros.model = modelEl.value.trim(); queueSave(); });
</script>`)
}

module.exports = { layout, loginPage, dashboardPage }
