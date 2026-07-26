import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t as sharedT, type Locale } from '@sahay/shared';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Top-level error boundary. Reads locale directly (it may render outside providers). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled error', error, info);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    let locale: Locale = 'en';
    try {
      const stored = localStorage.getItem('sahay.locale');
      if (stored === 'hi') locale = 'hi';
    } catch {
      /* ignore */
    }
    return (
      <div className="empty-state" role="alert" style={{ minHeight: '60dvh' }}>
        <h1>{sharedT(locale, 'misc.errorTitle')}</h1>
        <p>{sharedT(locale, 'misc.errorBody')}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {sharedT(locale, 'misc.reload')}
        </button>
      </div>
    );
  }
}
