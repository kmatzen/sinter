import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SDFNodeUI } from '../types/operations';

/**
 * `projectStore` — cloud save, load and share links.
 *
 * This had no test file at all, which is a gap of the same shape as the two
 * bugs found by hand today: the geometry is tested exhaustively and the
 * application shell around it is not. Save/load is where a user's work either
 * survives or does not, and the failure modes here are quiet — a save that
 * no-ops, a rename that never reaches the provider, an error swallowed into a
 * spinner that stops.
 *
 * The storage providers, auth and thumbnail cache are stubbed. The point is the
 * store's own decisions: when it skips a save, when it creates versus updates,
 * what it does with a failure, and what it leaves behind for the UI to read.
 */

const create = vi.fn();
const update = vi.fn();
const rename = vi.fn();
const read = vi.fn();
const isPublic = vi.fn();
const setPublic = vi.fn();
const getAccessToken = vi.fn();
const getCurrentProvider = vi.fn();

vi.mock('../storage', () => ({
  getStorageProvider: () => ({ create, update, rename, read, isPublic, setPublic }),
  buildShareUrl: (provider: string, id: string) => `https://sinter.test/shared#${provider}:${id}`,
}));

vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ getAccessToken }) },
  getCurrentProvider: () => getCurrentProvider(),
}));

vi.mock('../utils/thumbnail', () => ({ captureCanvasThumbnail: () => 'data:image/webp;base64,THUMB' }));
vi.mock('../storage/thumbnailCache', () => ({
  getThumbnail: vi.fn(), putThumbnail: vi.fn(), deleteThumbnail: vi.fn(),
}));

const { useProjectStore } = await import('./projectStore');
const { useModelerStore } = await import('./modelerStore');

const box = (width = 10): SDFNodeUI => ({
  id: 'b', kind: 'box', label: 'Box', params: { width, height: 10, depth: 10 }, children: [], enabled: true,
});

function resetStores() {
  useModelerStore.setState({ tree: box(), projectName: 'Untitled' });
  useProjectStore.setState({
    provider: null, projectId: null, remoteName: '', lastSavedHash: '',
    saving: false, dirty: false, saveError: null, shareUrl: null,
  });
}

describe('projectStore.save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('token');
    getCurrentProvider.mockReturnValue('google');
    create.mockResolvedValue({ externalId: 'new-id' });
    resetStores();
  });

  it('creates the project the first time and remembers its id', async () => {
    await useProjectStore.getState().save();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    const s = useProjectStore.getState();
    expect(s.projectId).toBe('new-id');
    expect(s.provider).toBe('google');
    expect(s.dirty).toBe(false);
  });

  it('updates rather than creating once it has an id', async () => {
    useProjectStore.setState({ projectId: 'existing', provider: 'google', remoteName: 'Untitled' });

    await useProjectStore.getState().save();

    expect(update).toHaveBeenCalledWith('token', 'existing', expect.objectContaining({ version: 1 }));
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * The save button is enabled by a dirty flag, but the store is the last line:
   * without this, autosave or a double-click writes the same bytes to the
   * provider repeatedly and burns the user's API quota.
   */
  it('skips a save when nothing changed since the last one', async () => {
    await useProjectStore.getState().save();
    create.mockClear();
    update.mockClear();

    await useProjectStore.getState().save();

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('saves again once the model actually changes', async () => {
    await useProjectStore.getState().save();
    update.mockClear();

    useModelerStore.setState({ tree: box(25) });
    await useProjectStore.getState().save();

    expect(update).toHaveBeenCalledTimes(1);
  });

  /** A rename has to reach the provider, or the cloud copy keeps the old name. */
  it('renames remotely when the local name has drifted', async () => {
    useProjectStore.setState({ projectId: 'existing', provider: 'google', remoteName: 'Old Name' });
    useModelerStore.setState({ projectName: 'New Name' });

    await useProjectStore.getState().save();

    expect(rename).toHaveBeenCalledWith('token', 'existing', 'New Name');
    expect(useProjectStore.getState().remoteName).toBe('New Name');
  });

  it('does not rename when the name is unchanged', async () => {
    useProjectStore.setState({ projectId: 'existing', provider: 'google', remoteName: 'Untitled' });
    await useProjectStore.getState().save();
    expect(rename).not.toHaveBeenCalled();
  });

  describe('when it fails', () => {
    it('surfaces the message and stops the spinner', async () => {
      create.mockRejectedValue(new Error('Drive quota exceeded'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useProjectStore.getState().save();

      const s = useProjectStore.getState();
      expect(s.saveError).toBe('Drive quota exceeded');
      expect(s.saving).toBe(false);
      logged.mockRestore();
    });

    /**
     * The dirty hash must not advance on a failure. If it did, the next save
     * would take the "nothing changed" shortcut and the user's work would
     * never reach the provider — while the UI showed no error the second time.
     */
    it('leaves the work dirty so the next save actually retries', async () => {
      // The project must already have an id, or this passes for the wrong
      // reason: the skip is `hash === lastSavedHash && projectId`, so with no
      // id the retry happens whatever the hash says. Caught by mutation —
      // advancing the hash on failure left the first version of this green.
      useProjectStore.setState({ projectId: 'existing', provider: 'google', remoteName: 'Untitled' });
      update.mockRejectedValue(new Error('offline'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useProjectStore.getState().save();
      expect(useProjectStore.getState().saveError).toBe('offline');

      update.mockClear();
      update.mockResolvedValue(undefined);
      useProjectStore.setState({ saveError: null });
      await useProjectStore.getState().save();

      // The retry reached the provider rather than being skipped as "already
      // saved" — which is how a failed save silently becomes lost work.
      expect(update).toHaveBeenCalledTimes(1);
      expect(useProjectStore.getState().saveError).toBeNull();
      logged.mockRestore();
    });

    it('refuses to save when nobody is signed in', async () => {
      getCurrentProvider.mockReturnValue(null);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useProjectStore.getState().save();

      expect(create).not.toHaveBeenCalled();
      expect(useProjectStore.getState().saveError).toMatch(/sign in/i);
      logged.mockRestore();
    });
  });
});

describe('projectStore.loadProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('token');
    isPublic.mockResolvedValue(false);
    resetStores();
  });

  it('puts the loaded tree and name into the modeler', async () => {
    read.mockResolvedValue({ version: 1, tree: box(42) });

    await useProjectStore.getState().loadProject('google', 'id-1', 'Bracket');

    expect(useModelerStore.getState().tree!.params.width).toBe(42);
    expect(useModelerStore.getState().projectName).toBe('Bracket');
  });

  /**
   * A freshly loaded project is not dirty. If it were, the next autosave would
   * write it straight back — and a load followed by an immediate save is how a
   * read-only mistake becomes a write.
   */
  it('lands clean, so a load does not immediately look like an edit', async () => {
    read.mockResolvedValue({ version: 1, tree: box(42) });
    await useProjectStore.getState().loadProject('google', 'id-1', 'Bracket');
    expect(useProjectStore.getState().dirty).toBe(false);

    await useProjectStore.getState().save();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('offers a share link for a project that is already public', async () => {
    read.mockResolvedValue({ version: 1, tree: box() });
    isPublic.mockResolvedValue(true);

    await useProjectStore.getState().loadProject('google', 'id-1', 'P');

    expect(useProjectStore.getState().shareUrl).toBe('https://sinter.test/shared#google:id-1');
  });

  it('offers none for a private one', async () => {
    read.mockResolvedValue({ version: 1, tree: box() });
    isPublic.mockResolvedValue(false);
    await useProjectStore.getState().loadProject('google', 'id-1', 'P');
    expect(useProjectStore.getState().shareUrl).toBeNull();
  });

  /**
   * Gists are URL-accessible by construction, so there is nothing to ask.
   * Asking anyway would be a wasted round trip that can also fail.
   */
  it('assumes a gist is shareable without asking the provider', async () => {
    read.mockResolvedValue({ version: 1, tree: box() });
    await useProjectStore.getState().loadProject('github', 'gist-1', 'P');

    expect(isPublic).not.toHaveBeenCalled();
    expect(useProjectStore.getState().shareUrl).toBe('https://sinter.test/shared#github:gist-1');
  });

  /** Whether it is shared is a nicety; failing to find out must not lose the load. */
  it('still loads when the sharing check throws', async () => {
    read.mockResolvedValue({ version: 1, tree: box(7) });
    isPublic.mockRejectedValue(new Error('permission denied'));

    await useProjectStore.getState().loadProject('google', 'id-1', 'P');

    expect(useModelerStore.getState().tree!.params.width).toBe(7);
    expect(useProjectStore.getState().shareUrl).toBeNull();
  });

  it('opens an empty document for a file with no tree in it', async () => {
    read.mockResolvedValue({ version: 1 });
    await useProjectStore.getState().loadProject('google', 'id-1', 'Empty');
    expect(useModelerStore.getState().tree).toBeNull();
  });
});

describe('projectStore.createProject', () => {
  beforeEach(() => { vi.clearAllMocks(); resetStores(); });

  it('detaches from the cloud copy so the next save creates a new one', async () => {
    useProjectStore.setState({ projectId: 'old', provider: 'google', shareUrl: 'https://x' });

    useProjectStore.getState().createProject();

    const s = useProjectStore.getState();
    expect(s.projectId).toBeNull();
    expect(s.provider).toBeNull();
    expect(s.shareUrl).toBeNull();
    expect(useModelerStore.getState().tree).toBeNull();
    expect(useModelerStore.getState().projectName).toBe('Untitled');
    // And clean, so an untouched new document is not offered for saving.
    expect(s.dirty).toBe(false);
  });
});

describe('projectStore.toggleShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('token');
    resetStores();
  });

  it('retains a GitHub URL because forgetting it would not revoke it', async () => {
    useProjectStore.setState({ projectId: 'gist-1', provider: 'github', shareUrl: 'https://old-link' });

    await useProjectStore.getState().toggleShare();

    expect(setPublic).not.toHaveBeenCalled();
    expect(useProjectStore.getState().shareUrl).toBe('https://old-link');
  });

  it('retains a Google URL when provider revocation fails', async () => {
    setPublic.mockRejectedValueOnce(new Error('still public'));
    useProjectStore.setState({ projectId: 'file-1', provider: 'google', shareUrl: 'https://old-link' });

    await expect(useProjectStore.getState().toggleShare()).rejects.toThrow('still public');

    expect(useProjectStore.getState().shareUrl).toBe('https://old-link');
  });

  it('clears a Google URL after verified provider revocation', async () => {
    setPublic.mockResolvedValueOnce(undefined);
    useProjectStore.setState({ projectId: 'file-1', provider: 'google', shareUrl: 'https://old-link' });

    await useProjectStore.getState().toggleShare();

    expect(setPublic).toHaveBeenCalledWith('token', 'file-1', false);
    expect(useProjectStore.getState().shareUrl).toBeNull();
  });
});
