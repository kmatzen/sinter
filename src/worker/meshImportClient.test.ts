import { beforeEach, describe, expect, it, vi } from 'vitest';

let worker: FakeWorker;
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { worker = this; }
}

describe('MeshImportSession cancellation', () => {
  beforeEach(() => vi.stubGlobal('Worker', FakeWorker));

  it('terminates preprocessing and rejects the outstanding request without committing data', async () => {
    const { MeshImportSession } = await import('./meshImportClient');
    const session = new MeshImportSession();
    const pending = session.finish(60_000);
    session.cancel();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
