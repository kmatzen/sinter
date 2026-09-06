import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsentStore } from './consent';
import { useModelerStore } from './modelerStore';
import { useViewportStore } from './viewportStore';
import { decodeProjectDocument } from '../types/documentDecoder';
import {
  loadFromLocal,
  saveToLocal,
  setLocalBackupBackendForTests,
  startLocalAutoSave,
  stopLocalAutoSave,
  useLocalBackupStore,
  type LocalBackupBackend,
  type LocalBackupRecord,
} from './localPersist';

class MemoryBackend implements LocalBackupBackend {
  current: LocalBackupRecord | null = null;
  previous: LocalBackupRecord | null = null;
  readError: Error | null = null;
  writeError: Error | null = null;

  async read() {
    if (this.readError) throw this.readError;
    return { current: this.current, previous: this.previous };
  }

  async write(record: LocalBackupRecord) {
    if (this.writeError) throw this.writeError;
    if (this.current) this.previous = this.current;
    this.current = record;
  }

  async clear() {
    this.current = null;
    this.previous = null;
  }
}

const project = (name: string, payload = '') => JSON.stringify({
  projectName: name,
  tree: { id: 'box', kind: 'box', label: 'Box', params: { width: 10 }, children: [], enabled: true, data: { payload } },
});

describe('IndexedDB local recovery', () => {
  let backend: MemoryBackend;
  const local = new Map<string, string>();

  beforeEach(() => {
    stopLocalAutoSave();
    backend = new MemoryBackend();
    setLocalBackupBackendForTests(backend);
    local.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); },
      removeItem: (key: string) => { local.delete(key); },
      clear: () => local.clear(),
      key: (index: number) => [...local.keys()][index] ?? null,
      get length() { return local.size; },
    });
    useConsentStore.setState({ granted: true, pendingReason: null });
    useModelerStore.getState().resetDocument(null, 'Untitled');
    useViewportStore.getState().setNamedViews([]);
  });

  it('stores projects larger than typical localStorage limits', async () => {
    useModelerStore.getState().fromJSON(project('Large', 'x'.repeat(6 * 1024 * 1024)));

    await expect(saveToLocal()).resolves.toBe(true);

    expect(backend.current!.json.length).toBeGreaterThan(5 * 1024 * 1024);
    expect(useLocalBackupStore.getState().status).toBe('saved');
  });

  it('makes quota or unavailable-storage failures visible and actionable', async () => {
    backend.writeError = new DOMException('quota exceeded', 'QuotaExceededError');

    await expect(saveToLocal()).resolves.toBe(false);

    const state = useLocalBackupStore.getState();
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/quota exceeded/i);
    expect(state.error).toMatch(/download the project/i);
  });

  it('migrates a valid legacy localStorage project only after durable write', async () => {
    localStorage.setItem('sinter_local_project', project('Legacy'));

    await expect(loadFromLocal()).resolves.toBe(true);

    expect(backend.current?.json).toContain('Legacy');
    expect(localStorage.getItem('sinter_local_project')).toBeNull();
    expect(useModelerStore.getState().projectName).toBe('Legacy');
  });

  it('keeps the legacy copy when migration storage is unavailable', async () => {
    backend.writeError = new Error('private mode denied storage');
    localStorage.setItem('sinter_local_project', project('Still Safe'));

    await expect(loadFromLocal()).resolves.toBe(true);

    expect(localStorage.getItem('sinter_local_project')).not.toBeNull();
    expect(useModelerStore.getState().projectName).toBe('Still Safe');
    expect(useLocalBackupStore.getState().status).toBe('failed');
  });

  it('falls back to the previous valid snapshot when current is corrupt', async () => {
    backend.current = { json: '{broken', savedAt: '2026-09-05T10:00:00.000Z' };
    backend.previous = { json: project('Previous Good'), savedAt: '2026-09-05T09:00:00.000Z' };

    await expect(loadFromLocal()).resolves.toBe(true);

    expect(useModelerStore.getState().projectName).toBe('Previous Good');
    expect(useLocalBackupStore.getState().error).toMatch(/recovered/i);
  });

  it('reports unavailable storage when no legacy recovery exists', async () => {
    backend.readError = new Error('IndexedDB unavailable');

    await expect(loadFromLocal()).resolves.toBe(false);

    expect(useLocalBackupStore.getState().status).toBe('failed');
    expect(useLocalBackupStore.getState().error).toMatch(/IndexedDB unavailable/i);
  });

  it('backs up view-only changes and coalesces them with model edits', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(backend, 'write');
    await startLocalAutoSave();
    useModelerStore.getState().setProjectName('Views');
    useViewportStore.getState().addNamedView({
      id: 'front', name: 'Front', createdAt: '2026-09-06T00:00:00.000Z',
      position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0],
      projection: 'orthographic', verticalSpan: 40,
      clipping: { enabled: false, axis: 'x', position: 0, flip: false },
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(write).toHaveBeenCalledOnce();
    expect(decodeProjectDocument(JSON.parse(backend.current!.json)).views).toHaveLength(1);
    stopLocalAutoSave();
    vi.useRealTimers();
  });

  it('round-trips pinned measurements through browser storage', async () => {
    const pin = {
      id: 'm1', createdAt: '2026-09-06T00:00:00.000Z',
      anchors: [{ nodeId: 'missing-after-edit', normalized: [0.5, 0.5, 0.5] as [number, number, number], fallback: [1, 2, 3] as [number, number, number] }],
    };
    useViewportStore.setState({ pinnedMeasurements: [pin] });
    await expect(saveToLocal()).resolves.toBe(true);
    useViewportStore.setState({ pinnedMeasurements: [] });

    await expect(loadFromLocal()).resolves.toBe(true);

    expect(useViewportStore.getState().pinnedMeasurements).toEqual([pin]);
  });

  it('stops listening to both project and named-view changes', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(backend, 'write');
    await startLocalAutoSave();
    stopLocalAutoSave();
    useModelerStore.getState().setProjectName('Not saved');
    useViewportStore.getState().setNamedViews([]);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(write).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
