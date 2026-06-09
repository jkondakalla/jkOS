import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Led, Screw, Vent } from '../components/hardware';
import { useAuth } from '../hooks/useAuth';

// ─── LoginPage ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { loginWithGoogle, state } = useAuth();
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [visible, setVisible]       = useState(false);

  useEffect(() => {
    // Fade in after a brief pause for a deliberate feel
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Surface any OAuth error forwarded via query string
    if (state.status === 'unauthenticated' && state.error) {
      setErrorMsg(errorLabel(state.error));
    }
  }, [state]);

  return (
    <div style={styles.root}>
      <div style={{ ...styles.panel, opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        {/* Corner screws */}
        <Screw rot={15}  style={styles.screwTL} />
        <Screw rot={-22} style={styles.screwTR} />
        <Screw rot={62}  style={styles.screwBL} />
        <Screw rot={-48} style={styles.screwBR} />

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

        {/* Vent separator */}
        <div style={styles.ventRow}>
          <Vent slats={3} width={48} />
          <div style={styles.ventLine} />
          <Vent slats={3} width={48} />
        </div>

        {/* Error display */}
        {errorMsg && (
          <div style={styles.errorBox}>
            <span style={styles.errorLabel}>ERR</span>
            <span style={styles.errorText}>{errorMsg}</span>
          </div>
        )}

        {/* Sign-in button */}
        <GoogleSignInButton onClick={loginWithGoogle} />

        {/* Footer */}
        <div style={styles.footer}>
          SECURE SESSION &nbsp;&middot;&nbsp; GOOGLE SSO
        </div>
      </div>
    </div>
  );
}

// ─── Google button ────────────────────────────────────────────────────────────

function GoogleSignInButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.button,
        background:  hovered ? 'rgba(255,176,0,0.10)' : 'transparent',
        color:       hovered ? 'var(--hub-amber)' : 'var(--hub-cream-dim, #b8a882)',
        borderColor: hovered ? 'var(--hub-amber)' : 'var(--hub-line-strong)',
        boxShadow:   hovered ? '0 0 12px var(--hub-amber-glow), inset 0 0 6px rgba(255,176,0,0.06)' : 'none',
      }}
    >
      <GoogleIcon style={{ marginRight: 10, opacity: hovered ? 1 : 0.6 }} />
      SIGN IN WITH GOOGLE
    </button>
  );
}

// ─── Minimal Google G icon ────────────────────────────────────────────────────

function GoogleIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
      aria-hidden="true"
    >
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// ─── Error label helper ───────────────────────────────────────────────────────

function errorLabel(code: string): string {
  switch (code) {
    case 'oauth_denied':   return 'Google sign-in was cancelled or denied.';
    case 'state_mismatch': return 'Request validation failed. Please try again.';
    case 'not_allowed':    return 'This Google account is not authorised to access ORDECK.';
    case 'server_error':   return 'An internal error occurred. Please try again.';
    default:               return `Sign-in error: ${code}`;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const screwBase: CSSProperties = { position: 'absolute' };

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

  screwTL: { ...screwBase, top: 6, left: 6 },
  screwTR: { ...screwBase, top: 6, right: 6 },
  screwBL: { ...screwBase, bottom: 6, left: 6 },
  screwBR: { ...screwBase, bottom: 6, right: 6 },

  headerRow: {
    display:    'flex',
    alignItems: 'center',
    marginBottom: 12,
    alignSelf:  'flex-start',
  },

  eyebrow: {
    fontSize:      9,
    letterSpacing: '0.22em',
    color:         'var(--hub-cream-dim, #b8a882)',
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
    color:         'var(--hub-cream-dim, #b8a882)',
    marginBottom:  24,
  },

  ventRow: {
    display:    'flex',
    alignItems: 'center',
    width:      '100%',
    marginBottom: 24,
    gap:        0,
  },

  ventLine: {
    flex:       1,
    height:     1,
    background: 'var(--hub-line)',
    margin:     '0 8px',
  },

  errorBox: {
    width:        '100%',
    background:   'rgba(180,30,20,0.12)',
    border:       '1px solid rgba(200,60,50,0.4)',
    padding:      '8px 12px',
    marginBottom: 16,
    display:      'flex',
    alignItems:   'flex-start',
    gap:          8,
  },

  errorLabel: {
    fontSize:      9,
    letterSpacing: '0.2em',
    color:         'var(--hub-red, #e03030)',
    fontWeight:    700,
    flexShrink:    0,
    paddingTop:    1,
  },

  errorText: {
    fontSize:   11,
    color:      'var(--hub-cream-dim, #b8a882)',
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
