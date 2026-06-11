import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * App-level error boundary. A render-time throw anywhere in the tree would
 * otherwise unmount React and leave a blank #root with only a console error.
 * This surfaces the message on-screen and offers a reload instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[sylibos] render error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center text-ink">
        <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted">
          SylibOS hit an unexpected error while rendering. Reloading usually clears it.
        </p>
        <pre className="max-w-lg overflow-auto rounded-lg border border-line bg-card px-4 py-3 text-left text-[12px] text-muted">
          {this.state.error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-accent-contrast"
        >
          Reload
        </button>
      </div>
    )
  }
}
