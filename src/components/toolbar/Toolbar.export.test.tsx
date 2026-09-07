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
const { triggerDownload } = vi.hoisted(() => ({ triggerDownload: vi.fn() }));

vi.mock('../../utils/download', () => ({ triggerDownload }));

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

import { Toolbar, affectedPreflightBounds } from './Toolbar';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { useProjectStore } from '../../store/projectStore';
import { useConfigurationStore } from '../../store/configurationStore';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

it('unions localized preflight findings for viewport highlighting', () => {
  const diagnostics = artifact(1, 12).diagnostics;
  expect(affectedPreflightBounds(diagnostics)).toEqual({ min: [0, 0, 0], max: [5, 6, 6] });
  expect(affectedPreflightBounds({ ...diagnostics, overhang: undefined, thickness: undefined })).toBeNull();
});

function artifact(size: number, triangleCount: number): ExportArtifact {
  return {
    blob: { size } as Blob, vertexCount: triangleCount * 3, triangleCount,
    achievedTolerance: 0.025,
    componentCount: 2,
    conformance: {
      status: 'verified', tolerance: 0.025,
      meshToSourceMax: 0.01, meshToSourceRms: 0.005,
      sourceToMeshMax: 0.02, sourceToMeshRms: 0.008,
      maxDeviation: 0.02, rmsDeviation: 0.007, meshSamples: 40, sourceSamples: 60,
    },
    diagnostics: {
      watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, inconsistentEdges: 0,
      degenerateTriangles: 0, invalidIndices: 0, nonFiniteVertices: 0, zeroAreaTriangles: 0,
      dimensions: [10, 20, 30],
      overhang: {
        overhangAngle: 45, buildDirection: 'z', riskyTriangles: 3, analyzedTriangles: 12,
        affectedTriangleIds: [1, 2, 3], affectedBounds: { min: [0, 0, 0], max: [5, 6, 1] }, affectedIdsTruncated: false,
      },
      thickness: {
        threshold: 1.2, status: 'analyzed', sampledTriangles: 12, totalTriangles: 12, thinTriangles: 2,
        minimumThickness: 0.8, affectedTriangleIds: [4, 5], affectedBounds: { min: [1, 2, 3], max: [4, 5, 6] }, affectedIdsTruncated: false,
      },
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
    expect(screen.getByText('10.00 × 20.00 × 30.00 mm')).toBeInTheDocument();
    expect(screen.getByText('≤ 0.0250 mm')).toBeInTheDocument();
    expect(screen.getByText('Verified components')).toBeInTheDocument();
    expect(screen.getByText('Verified samples')).toBeInTheDocument();
    expect(screen.getByText('Maximum deviation')).toBeInTheDocument();
    expect(screen.getByText(/Support risk: 3 of 12 export triangles/)).toBeInTheDocument();
    expect(screen.getByText(/Thin feature risk: 2 of 12 sampled export triangles/)).toBeInTheDocument();
    expect(screen.getAllByText(/Affected region:/)).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
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

    expect(exportSTL).toHaveBeenCalledWith(BOX, expect.any(Function), 128, { overhangAngle: 45, buildDirection: 'z', minimumWallThickness: 1.2 });

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

    expect(export3MF).toHaveBeenCalledWith(BOX, expect.any(Function), 384, { overhangAngle: 45, buildDirection: 'z', minimumWallThickness: 1.2 });

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

describe('Toolbar project versions', () => {
  beforeEach(() => {
    useModelerStore.setState({ tree: BOX, evaluatedTree: BOX, sdfDisplay: DISPLAY as any, evaluating: false });
    useProjectStore.setState({
      projectId: 'cloud-id', provider: 'google', saving: false,
      checkpoints: [{ id: 'v1', name: 'Before experiment', createdAt: '2026-09-06T12:00:00Z', tree: BOX }],
    });
  });

  afterEach(cleanup);

  it('exposes named versions, retention, and restore controls', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Project versions'));
    expect(screen.getByRole('dialog', { name: 'Project versions' })).toBeInTheDocument();
    expect(screen.getByText('Before experiment')).toBeInTheDocument();
    expect(screen.getByText(/10 newest versions/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });
});

describe('named configuration batch export', () => {
  const driven = { ...BOX, expressions: { width: 'width' } };
  const configurations = [
    { id: 'small', name: 'Small size', overrides: { width: '20' } },
    { id: 'large', name: 'Large size', overrides: { width: '30' } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useModelerStore.getState().resetDocument(driven, 'Bracket', [{ name: 'width', expression: '10', unit: 'mm' }]);
    useModelerStore.setState({ evaluatedTree: useModelerStore.getState().tree, sdfDisplay: DISPLAY as any, evaluating: false });
    useConfigurationStore.getState().reset(configurations, null, [{ name: 'width', expression: '10', unit: 'mm' }]);
  });
  afterEach(cleanup);

  it('resolves and downloads every variant sequentially with deterministic names', async () => {
    exportSTL.mockResolvedValue(artifact(100, 4));
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Configurations'));
    fireEvent.click(screen.getByRole('button', { name: 'Export all STL' }));
    await waitFor(() => expect(exportSTL).toHaveBeenCalledTimes(2));
    expect(exportSTL.mock.calls[0][0].params.width).toBe(20);
    expect(exportSTL.mock.calls[1][0].params.width).toBe(30);
    expect(triggerDownload.mock.calls.map((call) => call[1])).toEqual(['Bracket-Small-size.stl', 'Bracket-Large-size.stl']);
  });

  it('continues after a per-configuration failure and reports which variant failed', async () => {
    exportSTL.mockRejectedValueOnce(new Error('mesh invalid')).mockResolvedValueOnce(artifact(100, 4));
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Configurations'));
    fireEvent.click(screen.getByRole('button', { name: 'Export all STL' }));
    await waitFor(() => expect(exportSTL).toHaveBeenCalledTimes(2));
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    expect(useModelerStore.getState().error).toMatch(/Small size: mesh invalid/);
  });

  it('cancels the running variant and never starts the next one', async () => {
    const job = deferred<ExportArtifact>();
    exportSTL.mockReturnValue(job.promise);
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('Configurations'));
    fireEvent.click(screen.getByRole('button', { name: 'Export all STL' }));
    await waitFor(() => expect(screen.getByTitle('Cancel export')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Cancel export'));
    const cancelled = new Error('Cancelled');
    cancelled.name = 'CancelledError';
    job.reject(cancelled);
    await flush();
    expect(exportSTL).toHaveBeenCalledTimes(1);
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});

describe('Toolbar compact-width actions', () => {
  beforeEach(() => {
    useModelerStore.setState({
      tree: BOX, selectedNodeId: BOX.id, clipboard: BOX,
      evaluatedTree: BOX, sdfDisplay: DISPLAY as any, evaluating: false,
    });
    useProjectStore.setState({ projectId: null, provider: null, shareUrl: null, saving: false });
  });

  afterEach(cleanup);

  it('exposes copy, paste, and export resolution in the mobile overflow', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('More actions'));

    expect(screen.getByText('Copy selected node')).toBeInTheDocument();
    expect(screen.getByText('Paste node')).toBeInTheDocument();
    // The always-mounted desktop selector is the first; opening the compact
    // overflow adds the independently reachable mobile control.
    expect(screen.getAllByLabelText('Export resolution')).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: 'Draft' })).toHaveLength(2);

    fireEvent.click(screen.getByText('Copy selected node'));
    expect(screen.getByText('Node copied!')).toBeInTheDocument();
  });
});
