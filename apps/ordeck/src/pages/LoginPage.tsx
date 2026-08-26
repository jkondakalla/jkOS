import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Led } from '../components/hardware';
import { useAuth } from '../hooks/useAuth';

// ─── LoginPage ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { signIn, state } = useAuth();
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [visible, setVisible]       = useState(false);

  useEffect(() => {
    // Fade in after a brief pause for a deliberate feel
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Surface any sign-in error forwarded via query string
    if (state.status === 'unauthenticated' && state.error) {
      setErrorMsg(errorLabel(state.error));
    }
  }, [state]);

  return (
    <div style={styles.root}>
      <div style={{ ...styles.panel, opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        {/* Header row */}
        <div style={styles.headerRow}>
          <Led color="amber" steady style={{ marginRight: 8 }} />
          <span style={styles.eyebrow}>ORDECK OS v1.0.0</span>
        </div>

        {/* Separator */}
        <div style={styles.divider} />

        {/* Title */}
        <div style={styles.title} className="glow">ORDECK</div>

        {/* Subtitle */}
        <div style={styles.subtitle}>// AUTHENTICATION REQUIRED</div>

        {/* Separator */}
        <div style={{ ...styles.divider, marginBottom: 24 }} />

        {/* Error display */}
        {errorMsg && (
          <div style={styles.errorBox}>
            <span style={styles.errorLabel}>ERR</span>
            <span style={styles.errorText}>{errorMsg}</span>
          </div>
        )}

        {/* Sign-in button */}
        <SignInButton onClick={signIn} />

        {/* Footer */}
        <div style={styles.footer}>
          SECURE SESSION &nbsp;&middot;&nbsp; jkOS SSO
        </div>
      </div>
    </div>
  );
}

// ─── Sign-in button ───────────────────────────────────────────────────────────
// Bounces to the jkAuth portal, which owns the credential prompt. Until the 2026-08
// reset this wore Google branding; jkAuth is its own SSO now, so the panel names
// jkOS and nothing else.

function SignInButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.button,
        background:  hovered ? 'color-mix(in srgb, var(--hub-amber) 10%, transparent)' : 'transparent',
        color:       hovered ? 'var(--hub-amber)' : 'var(--hub-cream-dim)',
        borderColor: hovered ? 'var(--hub-amber)' : 'var(--hub-line-strong)',
        boxShadow:   hovered ? '0 0 12px var(--hub-amber-glow), inset 0 0 6px color-mix(in srgb, var(--hub-amber) 6%, transparent)' : 'none',
      }}
    >
      <KeyIcon style={{ marginRight: 10, opacity: hovered ? 1 : 0.6 }} />
      SIGN IN
    </button>
  );
}

// ─── Minimal key icon ─────────────────────────────────────────────────────────

function KeyIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
      aria-hidden="true"
    >
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9" />
      <path d="M18 12v3.5" />
      <path d="M15.5 12v2.5" />
    </svg>
  );
}

// ─── Error label helper ───────────────────────────────────────────────────────
// Codes the jkAuth portal appends as ?error=. `state_mismatch` and `server_error`
// survive the Google removal; the account-linking codes went with it.

function errorLabel(code: string): string {
  switch (code) {
    case 'state_mismatch': return 'Request validation failed. Please try again.';
    case 'not_allowed':    return 'This account is not authorised to access ORDECK.';
    case 'server_error':   return 'An internal error occurred. Please try again.';
    default:               return `Sign-in error: ${code}`;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    position:       'fixed',
    inset:          0,
    background:     'var(--hub-bg-0)',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    fontFamily:     'var(--hub-font-mono)',
    zIndex:         8000,
  },

  panel: {
    position:  'relative',
    background: 'var(--hub-bg-1)',
    border:    '1px solid var(--hub-line-strong)',
    padding:   '40px 48px 32px',
    width:     340,
    display:   'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap:        0,
  },

  headerRow: {
    display:    'flex',
    alignItems: 'center',
    marginBottom: 12,
    alignSelf:  'flex-start',
  },

  eyebrow: {
    fontSize:      9,
    letterSpacing: '0.22em',
    color:         'var(--hub-cream-dim)',
    textTransform: 'uppercase',
  },

  divider: {
    width:        '100%',
    height:       1,
    background:   'var(--hub-line)',
    marginBottom: 28,
  },

  title: {
    fontSize:      42,
    fontWeight:    700,
    letterSpacing: '0.18em',
    color:         'var(--hub-amber)',
    textShadow:    '0 0 12px var(--hub-amber-glow), 0 0 4px var(--hub-amber-glow)',
    marginBottom:  8,
  },

  subtitle: {
    fontSize:      10,
    letterSpacing: '0.2em',
    color:         'var(--hub-cream-dim)',
    marginBottom:  24,
  },

  errorBox: {
    width:        '100%',
    background:   'var(--hub-red-soft)',
    border:       '1px solid color-mix(in srgb, var(--hub-red) 40%, transparent)',
    padding:      '8px 12px',
    marginBottom: 16,
    display:      'flex',
    alignItems:   'flex-start',
    gap:          8,
  },

  errorLabel: {
    fontSize:      9,
    letterSpacing: '0.2em',
    color:         'var(--hub-red)',
    fontWeight:    700,
    flexShrink:    0,
    paddingTop:    1,
  },

  errorText: {
    fontSize:   11,
    color:      'var(--hub-cream-dim)',
    lineHeight: 1.5,
  },

  button: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    width:          '100%',
    padding:        '12px 20px',
    border:         '1px solid',
    fontSize:       11,
    letterSpacing:  '0.18em',
    cursor:         'pointer',
    fontFamily:     'var(--hub-font-mono)',
    fontWeight:     600,
    transition:     'background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
    marginBottom:   24,
  },

  footer: {
    fontSize:      9,
    letterSpacing: '0.18em',
    color:         'var(--hub-line-strong)',
    textTransform: 'uppercase',
  },
};
