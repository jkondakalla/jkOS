import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  widgetName: string;
  children: ReactNode;
  /** When this value changes, a caught error is cleared and children re-mount.
   *  The HUD passes the widget def, so editing a card in the workshop (or a new
   *  published/AI spec) auto-recovers a card that previously threw. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // A new resetKey (e.g. an edited/republished spec) means "try again" — drop
    // the stale error so the fresh definition gets a clean render.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.widgetName}] widget error:`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="hud-card" style={{
          height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, color: 'var(--hub-red)' }}>⚠</div>
          <div style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.15em', color: 'var(--hub-red)' }}>
            WIDGET FAULT
          </div>
          <div style={{ fontSize: 9, color: 'var(--hub-cream-dim)', maxWidth: 200, lineHeight: 1.5 }}>
            {this.props.widgetName.toUpperCase()} COULDN’T RENDER
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8,
              background: 'transparent',
              border: '1px solid var(--hub-line)',
              color: 'var(--hub-cream-dim)',
              fontFamily: 'var(--hub-font-mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
