import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import type { SDFNodeUI } from '../../types/operations';
import type { ExportArtifact } from '../../types/geometry';

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

function artifact(size: number, triangleCount: number): ExportArtifact {
  return {
    blob: { size } as Blob, vertexCount: triangleCount * 3, triangleCount,
    diagnostics: {
      watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, inconsistentEdges: 0,
      degenerateTriangles: 0, invalidIndices: 0, nonFiniteVertices: 0, zeroAreaTriangles: 0,
      dimensions: [10, 20, 30],
    },
  };
}

const BOX: SDFNodeUI = {
  id: 'n1', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true,
};
const DISPLAY = { glsl: 'sdf', paramCount: 0, paramValues: [], textures: [], bbMin: [-1, -1, -1], bbMax: [1, 1, 1], hasWarn: false };

/** Let queued microtasks run and React commit whatever they scheduled. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Toolbar export cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelerStore.setState({ tree: BOX, evaluatedTree: BOX, sdfDisplay: DISPLAY as any, evaluating: false });
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
    const job = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();

    job.resolve(artifact(1024, 12));
    await waitFor(() => expect(screen.getByText('Download')).toBeInTheDocument());
    expect(screen.getByText('Watertight')).toBeInTheDocument();
    expect(screen.getByText('10.0 × 20.0 × 30.0 mm')).toBeInTheDocument();
  });

  // The regression. The cancel button is on screen for the whole of
  // `exporting && exportProgress`, which outlasts the worker's reply: the
  // triangle-count read is another await, and React has not committed the
  // preview yet. A cancel there finds nothing in flight, so `cancelExport()`
  // no-ops — and without the epoch guard the preview lands anyway and the user
  // is handed the download they just declined. This is the exact interleaving
  // that failed in CI.
  it('suppresses the preview when cancelled after the worker replied', async () => {
    const job = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();

    // Resolve and cancel in the same turn, before React commits the preview.
    job.resolve(artifact(603_996, 11_800));
    const cancel = screen.getByTitle('Cancel export');
    expect(cancel).toBeInTheDocument();
    fireEvent.click(cancel);
    expect(cancelExport).toHaveBeenCalledTimes(1);

    await flush();

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Cancel export')).not.toBeInTheDocument();
  });

  it('suppresses the preview when the bridge rejects the export', async () => {
    const job = deferred<ExportArtifact>();
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

  it('surfaces a real export failure in application state', async () => {
    const job = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();
    job.reject(new Error('worker ran out of memory'));
    await flush();
    expect(useModelerStore.getState().error).toBe('STL export failed: worker ran out of memory');
  });

  it('does not export when the displayed geometry belongs to another tree revision', () => {
    useModelerStore.setState({ evaluatedTree: { ...BOX } });
    render(<Toolbar />);
    const button = screen.getByTitle('Export STL');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(exportSTL).not.toHaveBeenCalled();
  });

  // The epoch is per-cancel, not a latch: a cancelled export must not poison
  // the next one.
  it('still offers the download for the export started after a cancel', async () => {
    const first = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(first.promise);
    await startExport();

    fireEvent.click(screen.getByTitle('Cancel export'));
    const cancelled = new Error('Export cancelled');
    cancelled.name = 'CancelledError';
    first.reject(cancelled);
    await flush();

    const second = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(second.promise);
    fireEvent.click(screen.getByTitle('Export STL'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());

    second.resolve(artifact(2048, 40));
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
    const job = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(job.promise);
    await startExport();

    expect(exportSTL).toHaveBeenCalledWith(BOX, expect.any(Function), 128);

    job.resolve(artifact(1024, 12));
    await flush();
    useViewportStore.getState().setResolution(256);
  });

  it('exports 3MF at the resolution the user picked', async () => {
    useViewportStore.getState().setResolution(384);
    const job = deferred<ExportArtifact>();
    export3MF.mockReturnValue(job.promise);
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Export 3MF'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());

    expect(export3MF).toHaveBeenCalledWith(BOX, expect.any(Function), 384);

    job.resolve(artifact(2048, 7));
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
    useViewportStore.getState().setResolution(256);
  });

  it('suppresses the 3MF preview when cancelled after the worker replied', async () => {
    const job = deferred<ExportArtifact>();
    export3MF.mockReturnValue(job.promise);
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Export 3MF'));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Cancel export'));
    job.resolve(artifact(4096, 31));
    await flush();

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });
});
