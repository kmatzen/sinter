import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import type { SDFNodeUI } from '../../types/operations';

/**
 * The bridge is a module-level singleton that spawns two real Workers on
 * import, which jsdom has no equivalent for. Only the export surface matters
 * here, and `isCancelled` is kept faithful to the real implementation so the
 * component's error branch is exercised for real.
 */
const exportSTL = vi.fn();
const export3MF = vi.fn();
const cancelExport = vi.fn();

vi.mock('../../engine/workerBridge', () => {
  class CancelledError extends Error {
    constructor(message = 'Cancelled') {
      super(message);
      this.name = 'CancelledError';
    }
  }
  return {
    CancelledError,
    isCancelled: (err: unknown) => (err as any)?.name === 'CancelledError',
    workerBridge: {
      exportSTL: (...args: any[]) => exportSTL(...args),
      export3MF: (...args: any[]) => export3MF(...args),
      cancelExport: (...args: any[]) => cancelExport(...args),
    },
  };
});

import { Toolbar } from './Toolbar';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * A blob whose header read is a promise we control. The real component reads
 * the STL triangle count with `await blob.slice(80, 84).arrayBuffer()`, and
 * that await is the window this suite is about — see the `exportEpoch` comment
 * in Toolbar.tsx.
 */
function pendingBlob(size: number, header: Promise<ArrayBuffer>) {
  return { size, slice: () => ({ arrayBuffer: () => header }) } as unknown as Blob;
}

function triangleHeader(count: number): ArrayBuffer {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, count, true);
  return buf;
}

const BOX: SDFNodeUI = { id: 'n1', kind: 'box', params: { w: 10, h: 10, d: 10 }, children: [] } as unknown as SDFNodeUI;

/** Let queued microtasks run and React commit whatever they scheduled. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Toolbar export cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelerStore.setState({ tree: BOX, evaluating: false });
  });

  afterEach(() => {
    cleanup();
    useModelerStore.setState({ tree: null });
  });

  async function startExport() {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Export STL'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());
  }

  it('offers the download when an export completes untouched', async () => {
    const job = deferred<Blob>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();

    job.resolve(pendingBlob(1024, Promise.resolve(triangleHeader(12))));
    await waitFor(() => expect(screen.getByText('Download')).toBeInTheDocument());
  });

  // The regression. The cancel button is on screen for the whole of
  // `exporting && exportProgress`, which outlasts the worker's reply: the
  // triangle-count read is another await, and React has not committed the
  // preview yet. A cancel there finds nothing in flight, so `cancelExport()`
  // no-ops — and without the epoch guard the preview lands anyway and the user
  // is handed the download they just declined. This is the exact interleaving
  // that failed in CI.
  it('suppresses the preview when cancelled after the worker replied', async () => {
    const job = deferred<Blob>();
    const header = deferred<ArrayBuffer>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();

    // Worker replies. The component resumes and blocks on the header read.
    job.resolve(pendingBlob(603_996, header.promise));
    await flush();

    // The window is real: cancel is still offered, and nothing is in flight.
    const cancel = screen.getByTitle('Cancel export');
    expect(cancel).toBeInTheDocument();
    fireEvent.click(cancel);
    expect(cancelExport).toHaveBeenCalledTimes(1);

    header.resolve(triangleHeader(11_800));
    await flush();

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Cancel export')).not.toBeInTheDocument();
  });

  it('suppresses the preview when the bridge rejects the export', async () => {
    const job = deferred<Blob>();
    exportSTL.mockReturnValue(job.promise);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startExport();

    fireEvent.click(screen.getByTitle('Cancel export'));
    const cancelled = new Error('Export cancelled');
    cancelled.name = 'CancelledError';
    job.reject(cancelled);
    await flush();

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    // A cancel is a user decision, not a failure.
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  // The epoch is per-cancel, not a latch: a cancelled export must not poison
  // the next one.
  it('still offers the download for the export started after a cancel', async () => {
    const first = deferred<Blob>();
    exportSTL.mockReturnValue(first.promise);
    await startExport();

    fireEvent.click(screen.getByTitle('Cancel export'));
    const cancelled = new Error('Export cancelled');
    cancelled.name = 'CancelledError';
    first.reject(cancelled);
    await flush();

    const second = deferred<Blob>();
    exportSTL.mockReturnValue(second.promise);
    fireEvent.click(screen.getByTitle('Export STL'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());

    second.resolve(pendingBlob(2048, Promise.resolve(triangleHeader(40))));
    await waitFor(() => expect(screen.getByText('Download')).toBeInTheDocument());
  });

  /**
   * Export cost is cubic in the grid resolution, so this selector is the
   * largest lever a user has over a twenty-second export. The setting existed
   * in the viewport store before this and nothing read it — the worker was
   * hardcoded to 256 — so what is worth testing is that the choice actually
   * reaches the bridge.
   */
  it('exports at the resolution the user picked', async () => {
    useViewportStore.getState().setResolution(128);
    const job = deferred<Blob>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();

    expect(exportSTL).toHaveBeenCalledWith(BOX, expect.any(Function), 128);

    job.resolve(pendingBlob(1024, Promise.resolve(triangleHeader(12))));
    await flush();
    useViewportStore.getState().setResolution(256);
  });

  it('exports 3MF at the resolution the user picked', async () => {
    useViewportStore.getState().setResolution(384);
    const job = deferred<Blob>();
    export3MF.mockReturnValue(job.promise);
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Export 3MF'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());

    expect(export3MF).toHaveBeenCalledWith(BOX, expect.any(Function), 384);

    job.resolve({ size: 2048 } as Blob);
    await flush();
    useViewportStore.getState().setResolution(256);
  });

  it('suppresses the 3MF preview when cancelled after the worker replied', async () => {
    const job = deferred<Blob>();
    export3MF.mockReturnValue(job.promise);
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Export 3MF'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Cancel export'));
    job.resolve({ size: 4096 } as Blob);
    await flush();

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });
});
