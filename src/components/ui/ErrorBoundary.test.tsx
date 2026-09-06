import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload } from '../../utils/download';
import { useModelerStore } from '../../store/modelerStore';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../../utils/download', () => ({ triggerDownload: vi.fn() }));

function Crash(): never {
  throw new Error('render failed with secret project content');
}

function StaleChunk(): never {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/ModelerApp-old.js');
}

describe('ErrorBoundary', () => {
  const suppressExpectedRenderError = (event: ErrorEvent) => event.preventDefault();

  beforeEach(() => {
    vi.mocked(triggerDownload).mockReset();
    const tree = { id: 'box', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true } as any;
    useModelerStore.setState({ tree, lastValidTree: tree, projectName: 'Crash test' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', suppressExpectedRenderError);
  });

  afterEach(() => {
    window.removeEventListener('error', suppressExpectedRenderError);
    vi.restoreAllMocks();
  });

  it('keeps recovery available after a render crash', async () => {
    render(<ErrorBoundary><Crash /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText(/secret project content/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Download recovery file' }));
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledOnce());
    const [blob, filename] = vi.mocked(triggerDownload).mock.calls[0];
    expect(blob.type).toBe('application/json');
    expect(filename).toBe('Crash test-recovery.json');
    expect(screen.getByText('Downloaded working document.')).toBeTruthy();
  });

  it('offers sanitized diagnostics without transmitting them', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ErrorBoundary><Crash /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Show copyable diagnostics' }));
    const report = (screen.getByLabelText('Diagnostic report') as HTMLTextAreaElement).value;
    expect(report).toContain('"appVersion"');
    expect(report).not.toContain('secret project content');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reloads the current editor route when a stale lazy chunk fails', () => {
    const reload = vi.fn();
    window.history.replaceState({}, '', '/');
    render(<ErrorBoundary reload={reload}><StaleChunk /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry editor' }));
    expect(window.location.pathname).toBe('/app');
    expect(reload).toHaveBeenCalledOnce();
  });
});
