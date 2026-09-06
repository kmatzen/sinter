import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { triggerDownload } from '../../utils/download';
import { buildDiagnosticReport, buildRecoveryFile } from './recovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
  recoveryStatus: string | null;
  diagnosticsVisible: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: '', recoveryStatus: null, diagnosticsVisible: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: '', recoveryStatus: null, diagnosticsVisible: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private downloadRecovery = async () => {
    this.setState({ recoveryStatus: 'Preparing recovery file…' });
    try {
      const recovery = await buildRecoveryFile();
      if (!recovery) {
        this.setState({ recoveryStatus: 'No serializable recovery document is available.' });
        return;
      }
      triggerDownload(new Blob([recovery.json], { type: 'application/json' }), recovery.filename);
      this.setState({ recoveryStatus: `Downloaded ${recovery.source}.` });
    } catch {
      this.setState({ recoveryStatus: 'Recovery data could not be read. Reloading will not erase the browser backup.' });
    }
  };

  private retry = () => {
    this.setState({ hasError: false, error: null, componentStack: '', recoveryStatus: null, diagnosticsVisible: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center p-8" style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
          <div className="text-center max-w-lg">
            <div className="text-4xl mb-4">:/</div>
            <h1 className="text-lg font-medium mb-2">Something went wrong</h1>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              The editor stopped unexpectedly. Your browser recovery data has not been cleared.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => { void this.downloadRecovery(); }} className="px-4 py-2 rounded-md text-sm font-medium"
                      style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
                Download recovery file
              </button>
              <button onClick={this.retry} className="px-4 py-2 rounded-md text-sm font-medium"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
                Retry editor
              </button>
              <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-md text-sm font-medium"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
                Reload app
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              Retry and reload keep the browser backup. Clearing site data is the action that removes it.
            </p>
            {this.state.recoveryStatus && <p role="status" className="text-xs mt-2">{this.state.recoveryStatus}</p>}
            <button onClick={() => this.setState((state) => ({ diagnosticsVisible: !state.diagnosticsVisible }))}
                    className="mt-4 text-xs underline" style={{ color: 'var(--text-muted)' }}>
              {this.state.diagnosticsVisible ? 'Hide diagnostics' : 'Show copyable diagnostics'}
            </button>
            {this.state.diagnosticsVisible && (
              <textarea readOnly aria-label="Diagnostic report"
                        value={buildDiagnosticReport(this.state.error ?? new Error('Unknown error'), this.state.componentStack)}
                        className="mt-2 w-full h-40 rounded p-2 text-[10px] font-mono text-left"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }} />
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
