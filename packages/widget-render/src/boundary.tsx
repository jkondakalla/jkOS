/**
 * boundary.tsx — one card's fault, contained.
 *
 * renderWidget wraps every card in one of these, so a widget that throws while rendering
 * (a malformed published, AI or workshop spec) draws a single WIDGET FAULT tile instead of
 * taking down every card around it. The gate's render check (check:widget-render) fails
 * on any cell that shows it.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  widgetName: string;
  children: ReactNode;
  /** When this value changes, a caught error is cleared and children re-mount. A host
   *  passes the widget def, so editing a card (or a new published/AI spec) auto-recovers
   *  a card that previously threw. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class WidgetBoundary extends Component<Props, State> {
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
        <div className="hud-card hud-w-fault" data-widget-fault="">
          <div className="hud-w-fault-mark">⚠</div>
          <div className="hud-w-fault-title">WIDGET FAULT</div>
          <div className="hud-w-fault-name">{this.props.widgetName.toUpperCase()} COULDN’T RENDER</div>
          <button className="hud-w-fault-retry" onClick={() => this.setState({ error: null })}>RETRY</button>
        </div>
      );
    }
    return this.props.children;
  }
}
