import { describe, expect, it, vi } from 'vitest';
import { LocalProjectConflictError, moveCloudProjectToLocal, type LocalProjectDestination } from './projectTransfer';

function memory(initial: string | null = null): LocalProjectDestination {
  let value = initial;
  return {
    read: async () => value,
    write: async (next) => { value = next; },
    clear: async () => { value = null; },
  };
}

const options = (destination: LocalProjectDestination, overrides = {}) => ({
  destination, projectName: 'Cloud B',
  readSource: vi.fn(async () => ({ tree: { id: 'b' } })),
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
    expect(JSON.parse((await storage.read())!)).toMatchObject({ projectName: 'Cloud B', tree: { id: 'b' } });
  });

  it('deletes the source only after a verified destination commit', async () => {
    const storage = memory();
    const args = options(storage);
    await expect(moveCloudProjectToLocal(args)).resolves.toEqual({ status: 'moved' });
    expect(args.deleteSource).toHaveBeenCalledOnce();
  });
});
