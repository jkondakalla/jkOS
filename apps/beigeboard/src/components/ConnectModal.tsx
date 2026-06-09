import React, { useState, useRef } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, sourceOf } from '../lib/theme'
import { Eyebrow } from './SharedComponents'

export function ConnectModal({ open, onClose, accounts, onConnect, onDisconnect, onSync, apiUrl }: any) {
  const [connecting, setConnecting] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [icloudForm, setIcloudForm] = useState(false)
  const [icloudUser, setIcloudUser] = useState('')
  const [icloudPass, setIcloudPass] = useState('')
  const [icloudErr,  setIcloudErr]  = useState<string | null>(null)
  const msgListenerRef = useRef<any>(null)
  if (!open) return null

  const PROVIDERS = [
    { id: 'google',  label: 'Google Calendar',         sub: 'Personal & work · OAuth',   mark: 'G' },
    { id: 'outlook', label: 'Outlook · Microsoft 365', sub: 'OAuth · M365 tenants',      mark: 'O' },
    { id: 'icloud',  label: 'iCloud Calendar',         sub: 'App-specific password',     mark: '◐' },
  ]

  const openOAuthPopup = (provider: string, route: string, successType: string, errorType: string) => {
    const popup = window.open(`${apiUrl}${route}`, `${provider}-cal-auth`,
      'width=520,height=680,left=200,top=80')
    if (!popup) {
      setOauthError('Popup blocked — please allow popups for this site and try again.')
      return
    }
    setConnecting(provider)

    const cleanup = () => {
      window.removeEventListener('message', onMsg)
      clearInterval(closedPoll)
    }

    const onMsg = (e: MessageEvent) => {
      // Only accept messages from our own origin to prevent cross-origin forgery
      if (e.origin !== window.location.origin) return
      if (e.data?.type === successType) {
        cleanup()
        setConnecting(null)
        onConnect({ ...PROVIDERS.find(p => p.id === provider), email: e.data.email })
      } else if (e.data?.type === errorType) {
        cleanup()
        setConnecting(null)
        setOauthError('Sign-in failed: ' + e.data.error)
      }
    }

    // Detect if the user closed the popup without completing OAuth
    const closedPoll = setInterval(() => {
      if (popup.closed) {
        cleanup()
        setConnecting(null)
      }
    }, 500)

    window.addEventListener('message', onMsg)
    msgListenerRef.current = onMsg
  }

  const handleConnect = (provider: any) => {
    setOauthError(null)
    setIcloudErr(null)
    if (provider.id === 'google') {
      openOAuthPopup('google', '/api/auth/google', 'google-auth-success', 'google-auth-error')
    } else if (provider.id === 'outlook') {
      openOAuthPopup('outlook', '/api/auth/outlook', 'outlook-auth-success', 'outlook-auth-error')
    } else if (provider.id === 'icloud') {
      setIcloudForm(true)
    }
  }

  const handleIcloudSubmit = async () => {
    if (!icloudUser || !icloudPass) { setIcloudErr('Apple ID and app password are required.'); return }
    setConnecting('icloud'); setIcloudErr(null)
    try {
      const r = await fetch(`${apiUrl}/api/auth/icloud`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: icloudUser, appPassword: icloudPass }),
      })
      const data = await r.json()
      if (!r.ok) { setIcloudErr(data.error || 'iCloud sign-in failed.'); setConnecting(null); return }
      setConnecting(null)
      setIcloudForm(false); setIcloudUser(''); setIcloudPass('')
      onConnect({ ...PROVIDERS.find(p => p.id === 'icloud'), email: data.email })
    } catch (e: any) { setIcloudErr(e.message); setConnecting(null) }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(10, 8, 6, 0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32, backdropFilter: 'blur(3px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(640px, 100%)', maxHeight: '88vh',
        background: 'var(--color-paper)', border: `1px solid 'var(--color-line)'`,
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} className="modal-in">
        <div style={{
          padding: '22px 28px 18px',
          borderBottom: `1px solid 'var(--color-line)'`, background: 'var(--color-paper-2)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <Eyebrow style={{ marginBottom: 6 }}>Sources</Eyebrow>
            <h2 style={{
              fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 26,
              margin: 0, letterSpacing: '-0.02em', color: 'var(--color-ink)',
            }}>Connect a <em style={{ color: 'var(--color-accent)', textShadow: `0 0 18px var(--color-accent-glow)` }}>calendar</em>.</h2>
            <p style={{
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
              color: 'var(--color-muted)', margin: '6px 0 0', lineHeight: 1.4,
            }}>
              Sign in once. Events flow in. The schedule keeps itself.
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'var(--color-muted)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1,
          }}>✕</button>
        </div>

        <div style={{ padding: '16px 28px 0' }}>
          <Eyebrow style={{ marginBottom: 8 }}>Connected</Eyebrow>
          {accounts.filter((a: any) => a.connected).length === 0 ? (
            <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)', margin: '0 0 12px' }}>
              No calendars connected yet.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {accounts.filter((a: any) => a.connected).map((a: any) => {
                const s = sourceOf(a.id)
                return (
                  <li key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    border: `1px solid 'var(--color-line-strong)'`, background: 'var(--color-paper-2)',
                  }}>
                    <span style={{ width: 10, height: 10, background: s.hex, borderRadius: '50%' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: FONT_BODY, fontSize: 12, color: 'var(--color-ink)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{s.label}</div>
                      <div style={{
                        fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 11, color: 'var(--color-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{a.email}</div>
                    </div>
                    <button onClick={() => onSync(a.id)} style={{
                      background: 'transparent', border: 'none',
                      fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11,
                      color: 'var(--color-muted)', cursor: 'pointer', padding: '0 0 0 4px',
                      textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2,
                    }}>sync</button>
                    <button onClick={() => onDisconnect(a.id)} style={{
                      background: 'transparent', border: 'none',
                      fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11,
                      color: 'var(--color-muted)', cursor: 'pointer', padding: '0 0 0 8px',
                      textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2,
                    }}>disconnect</button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div style={{ padding: '20px 28px 28px', overflowY: 'auto' }}>
          {icloudForm ? (
            <div>
              <Eyebrow style={{ marginBottom: 10 }}>iCloud credentials</Eyebrow>
              <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11, color: 'var(--color-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                Use an <strong style={{ color: 'var(--color-ink)' }}>app-specific password</strong> — not your Apple ID password.
                Generate one at appleid.apple.com under Sign-In &amp; Security.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                <input
                  type="email" placeholder="Apple ID (e.g. you@icloud.com)"
                  value={icloudUser} onChange={e => setIcloudUser(e.target.value)}
                  style={{
                    background: 'var(--color-paper-2)', border: `1px solid 'var(--color-line)'`,
                    color: 'var(--color-ink)', fontFamily: FONT_BODY, fontSize: 12,
                    padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
                  }}
                />
                <input
                  type="password" placeholder="App-specific password"
                  value={icloudPass} onChange={e => setIcloudPass(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleIcloudSubmit()}
                  style={{
                    background: 'var(--color-paper-2)', border: `1px solid 'var(--color-line)'`,
                    color: 'var(--color-ink)', fontFamily: FONT_BODY, fontSize: 12,
                    padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
                  }}
                />
              </div>
              {icloudErr && (
                <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-accent)', margin: '0 0 10px', lineHeight: 1.5 }}>
                  {icloudErr}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleIcloudSubmit} disabled={connecting === 'icloud'} className="btn-action" style={{
                  flex: 1, padding: '9px 14px',
                  background: 'var(--color-paper-2)', border: `1px solid 'var(--color-line)'`,
                  fontFamily: FONT_BODY, fontSize: 12, color: 'var(--color-ink)', cursor: connecting === 'icloud' ? 'wait' : 'pointer',
                }}>
                  {connecting === 'icloud' ? 'Connecting…' : 'Connect iCloud'}
                </button>
                <button onClick={() => { setIcloudForm(false); setIcloudErr(null) }} style={{
                  padding: '9px 14px',
                  background: 'transparent', border: `1px solid 'var(--color-line-strong)'`,
                  fontFamily: FONT_BODY, fontSize: 12, color: 'var(--color-muted)', cursor: 'pointer',
                }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <Eyebrow style={{ marginBottom: 12 }}>Add new</Eyebrow>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {PROVIDERS.map(p => {
                  const isConn = connecting === p.id
                  return (
                    <button key={p.id} onClick={() => handleConnect(p)} disabled={isConn} className="btn-action" style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px',
                      background: 'var(--color-paper-2)', border: `1px solid 'var(--color-line)'`,
                      cursor: isConn ? 'wait' : 'pointer', textAlign: 'left',
                    }}>
                      <span style={{
                        width: 34, height: 34,
                        background: 'var(--color-paper)', border: `1px solid 'var(--color-line)'`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 18, color: 'var(--color-ink)',
                        flexShrink: 0,
                      }}>{p.mark}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--color-ink)' }}>{p.label}</div>
                        <div style={{
                          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11, color: 'var(--color-muted)', marginTop: 2,
                        }}>{isConn ? 'opening provider…' : p.sub}</div>
                      </div>
                      <span style={{
                        fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.14em',
                        textTransform: 'uppercase', color: 'var(--color-accent)',
                      }}>{isConn ? '…' : 'sign in →'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {oauthError && (
            <p style={{
              fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-accent)',
              marginTop: 10, lineHeight: 1.5,
            }}>{oauthError}</p>
          )}

          <p style={{
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11,
            color: 'var(--color-muted)', marginTop: 18, lineHeight: 1.5,
            paddingTop: 14, borderTop: `1px solid 'var(--color-line-strong)'`,
          }}>
            BeigeBoard reads events only. Never message content. Revoke anytime from your provider's settings.
          </p>
        </div>
      </div>
    </div>
  )
}
