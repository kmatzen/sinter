import { describe, expect, it, vi } from 'vitest';
import { decodeProjectDocument } from '../types/documentDecoder';
import { encodeTransferredProject, LocalProjectConflictError, moveCloudProjectToLocal, type LocalProjectDestination } from './projectTransfer';

function memory(initial: string | null = null): LocalProjectDestination {
  let value = initial;
  return {
    read: async () => value,
    write: async (next) => { value = next; },
    clear: async () => { value = null; },
  };
}

const legacyBody = { tree: { kind: 'sphere', params: { radius: 5 }, children: [] } };

const options = (destination: LocalProjectDestination, overrides = {}) => ({
  destination, projectName: 'Cloud B',
  readSource: vi.fn(async () => legacyBody),
  deleteSource: vi.fn(async () => {}),
  ...overrides,
});

describe('moveCloudProjectToLocal', () => {
  it('never overwrites an existing project without an explicit replace decision', async () => {
    const storage = memory('{"projectName":"Local A","tree":{"id":"a"}}');
    const args = options(storage);
    await expect(moveCloudProjectToLocal(args)).rejects.toBeInstanceOf(LocalProjectConflictError);
    expect(args.readSource).not.toHaveBeenCalled();
    expect(await storage.read()).toContain('Local A');
  });

  it('leaves the source untouched and restores the destination after quota failure', async () => {
    const storage = memory('old');
    storage.write = vi.fn(async () => { throw new Error('quota'); });
    const args = options(storage, { replaceExisting: true });
    await expect(moveCloudProjectToLocal(args)).rejects.toThrow('quota');
    expect(args.deleteSource).not.toHaveBeenCalled();
  });

  it('does not delete the source when read-back is corrupt', async () => {
    const storage = memory();
    storage.write = vi.fn(async () => {});
    const args = options(storage);
    await expect(moveCloudProjectToLocal(args)).rejects.toThrow(/verification/);
    expect(args.deleteSource).not.toHaveBeenCalled();
  });

  it('makes no local change when source read or token refresh fails', async () => {
    const storage = memory();
    const args = options(storage, { readSource: vi.fn(async () => { throw new Error('token expired'); }) });
    await expect(moveCloudProjectToLocal(args)).rejects.toThrow('token expired');
    expect(await storage.read()).toBeNull();
    expect(args.deleteSource).not.toHaveBeenCalled();
  });

  it('reports a copy and retains valid local data when source deletion fails', async () => {
    const storage = memory();
    const result = await moveCloudProjectToLocal(options(storage, {
      deleteSource: vi.fn(async () => { throw new Error('token expired'); }),
    }));
    expect(result.status).toBe('copied');
    expect(JSON.parse((await storage.read())!)).toMatchObject({ version: 2, projectName: 'Cloud B', tree: { kind: 'sphere' } });
  });

  it('deletes the source only after a verified destination commit', async () => {
    const storage = memory();
    const args = options(storage);
    await expect(moveCloudProjectToLocal(args)).resolves.toEqual({ status: 'moved' });
    expect(args.deleteSource).toHaveBeenCalledOnce();
  });

  it('preserves the complete validated document envelope', async () => {
    const view = {
      id: 'front', name: 'Front', createdAt: '2026-01-01T00:00:00.000Z',
      position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0],
      projection: 'orthographic', verticalSpan: 40,
      clipping: { enabled: true, axis: 'x', position: 2, flip: false },
    };
    const tree = {
      id: 'sphere', kind: 'sphere', label: 'Sphere', params: { radius: 7 },
      expressions: { radius: 'size' }, children: [], enabled: true,
    };
    const body = {
      version: 2, revision: 'provider-only', thumbnail: 'data:image/png;base64,AA==', tree,
      parameters: [{ name: 'size', expression: '7', unit: 'mm' }], views: [view],
      checkpoints: [{ id: 'cp', name: 'Known good', createdAt: '2026-01-02T00:00:00.000Z', tree, parameters: [{ name: 'size', expression: '7', unit: 'mm' }], views: [view] }],
    };

    const encoded = encodeTransferredProject('Complete', body);
    const raw = JSON.parse(encoded);
    expect(raw).not.toHaveProperty('revision');
    expect(raw).toMatchObject({ version: 2, projectName: 'Complete', thumbnail: body.thumbnail });
    expect(decodeProjectDocument(raw)).toEqual(decodeProjectDocument({ ...body, projectName: 'Complete' }));

    const storage = memory();
    await moveCloudProjectToLocal(options(storage, { readSource: vi.fn(async () => body) }));
    expect(decodeProjectDocument(JSON.parse((await storage.read())!))).toEqual(decodeProjectDocument({ ...body, projectName: 'Cloud B' }));
  });
});
