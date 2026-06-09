import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  widgetName: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.widgetName}] widget error:`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, color: 'var(--hub-red)' }}>⚠</div>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--hub-red)' }}>
            MODULE FAULT
          </div>
          <div style={{ fontSize: 9, color: 'var(--hub-cream-dim)', maxWidth: 200, lineHeight: 1.5 }}>
            {this.props.widgetName.toUpperCase()} REMOTE UNAVAILABLE
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
