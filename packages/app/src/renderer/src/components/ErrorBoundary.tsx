import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Resetting key: when it changes, the boundary clears its error. */
  resetKey?: string;
}
interface State {
  error: Error | null;
  key?: string;
}

/** Keeps a rendering error in one pane from taking down the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <h3>Something went wrong while showing this.</h3>
        <pre>{this.state.error.message}</pre>
        <p className="muted">
          Try the Source view, or pick another block. If it keeps happening, the file is worth a
          look in a text editor.
        </p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
