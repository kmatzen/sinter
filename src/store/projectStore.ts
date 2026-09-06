import { create } from 'zustand';
import { useModelerStore } from './modelerStore';
import { useAuthStore, getCurrentProvider } from './authStore';
import { captureCanvasThumbnail } from '../utils/thumbnail';
import { StorageConflictError, getStorageProvider, buildShareUrl, type ProviderName, type ProjectFileBody } from '../storage';
import { getThumbnail, putThumbnail, deleteThumbnail, thumbnailCacheKey } from '../storage/thumbnailCache';
import { useChatStore } from './chatStore';
import { useModalStore } from './modalStore';
import { decodeProjectDocument, decodeTree } from '../types/documentDecoder';

interface ProjectState {
  provider: ProviderName | null;
  projectId: string | null; // external ID at the provider
  /** Name last persisted at the provider (so we know whether to call rename). */
  remoteName: string;
  lastSavedHash: string;
  revision: string;
  generation: number;
  saving: boolean;
  saveError: string | null;
  saveConflict: boolean;
  /** App share URL (origin + /shared#...) when this project is shareable, else null. */
  shareUrl: string | null;

  setProjectId: (id: string | null, provider?: ProviderName | null) => void;
  save: () => Promise<boolean>;
  loadProject: (provider: ProviderName, externalId: string, name: string) => Promise<void>;
  loadLocalDocument: (name: string, tree: unknown) => void;
  createProject: () => void;
  toggleShare: () => Promise<void>;
  clearSaveError: () => void;
  reloadRemote: () => Promise<void>;
  saveAsCopy: () => Promise<boolean>;
  overwriteRemote: () => Promise<boolean>;
}

function bodyHash(): string {
  const { tree, projectName } = useModelerStore.getState();
  return JSON.stringify({ tree, projectName });
}

let nextGeneration = 1;

function accountKey(provider: ProviderName): string {
  const user = useAuthStore.getState().user;
  return `${provider}:${user?.id ?? user?.email ?? 'anonymous'}`;
}

function thumbnailKey(provider: ProviderName, externalId: string): string {
  return thumbnailCacheKey(provider, accountKey(provider), externalId);
}

function authIdentity(): string {
  const user = useAuthStore.getState().user;
  return `${getCurrentProvider() ?? 'none'}:${user?.id ?? user?.email ?? 'none'}`;
}

type CloudEditNotice = { provider: ProviderName; account: string; externalId: string; revision: string };
const editChannel = typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined'
  ? null : new window.BroadcastChannel('sinter-cloud-edits-v1');

function announceEdit(provider: ProviderName, externalId: string, revision: string): void {
  if (revision) editChannel?.postMessage({ provider, account: accountKey(provider), externalId, revision } satisfies CloudEditNotice);
}

export function isCloudDirty(): boolean {
  return bodyHash() !== useProjectStore.getState().lastSavedHash;
}

export function requestDocumentReplacement(replace: () => void | Promise<void>): void {
  if (!isCloudDirty()) {
    void replace();
    return;
  }
  useModalStore.getState().showConfirm(
    'This project has changes that have not been saved to cloud. Save them before replacing the document?',
    () => { void replace(); },
    {
      confirmLabel: 'Discard',
      secondaryLabel: 'Save',
      onSecondary: () => {
        void useProjectStore.getState().save().then((saved) => {
          if (saved) void replace();
          else useModalStore.getState().showToast('Save failed. The current project was kept open.');
        });
      },
    },
  );
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  provider: null,
  projectId: null,
  remoteName: '',
  lastSavedHash: bodyHash(),
  revision: '',
  generation: nextGeneration,
  saving: false,
  saveError: null,
  saveConflict: false,
  shareUrl: null,

  setProjectId: (id, provider) => set({
    projectId: id, provider: provider ?? null, revision: '', generation: ++nextGeneration,
  }),

  clearSaveError: () => set({ saveError: null, saveConflict: false }),

  save: async () => {
    const { saving, projectId, provider, remoteName, revision, generation } = get();
    if (saving) return false;

    const hash = bodyHash();
    if (hash === get().lastSavedHash && projectId) return true;

    set({ saving: true, saveError: null, saveConflict: false });
    const identity = authIdentity();
    try {
      const { projectName, tree } = useModelerStore.getState();
      const thumbnail = captureCanvasThumbnail();
      const body: ProjectFileBody = { version: 1, thumbnail, tree };

      const activeProvider = provider ?? getCurrentProvider();
      if (!activeProvider) throw new Error('Sign in to save to cloud');
      const accessToken = await useAuthStore.getState().getAccessToken();
      const storage = getStorageProvider(activeProvider);

      let externalId = projectId;
      let savedRevision = revision;
      if (externalId) {
        const updated = await storage.update(accessToken, externalId, body, savedRevision);
        savedRevision = updated?.revision ?? savedRevision;
        if (projectName !== remoteName) {
          const renamed = await storage.rename(accessToken, externalId, projectName, savedRevision);
          savedRevision = renamed?.revision ?? savedRevision;
        }
      } else {
        const result = await storage.create(accessToken, projectName, body);
        externalId = result.externalId;
        savedRevision = result.revision ?? '';
      }

      if (thumbnail) await putThumbnail(thumbnailKey(activeProvider, externalId), thumbnail);

      // Opening/creating another document or changing accounts invalidates
      // every completion from this operation. The remote copy may exist, but
      // it must never attach its identity or clean state to a different tree.
      if (get().generation !== generation || authIdentity() !== identity) return false;

      set({
        provider: activeProvider,
        projectId: externalId,
        remoteName: projectName,
        lastSavedHash: hash,
        revision: savedRevision,
        saveConflict: false,
      });
      announceEdit(activeProvider, externalId, savedRevision);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed';
      console.error('Save failed:', err);
      if (get().generation === generation) set({
        saveError: message,
        saveConflict: err instanceof StorageConflictError ||
          (err instanceof Error && err.name === 'StorageConflictError'),
      });
      return false;
    } finally {
      if (get().generation === generation) set({ saving: false });
    }
  },

  reloadRemote: async () => {
    const { provider, projectId, remoteName } = get();
    if (provider && projectId) await get().loadProject(provider, projectId, remoteName);
  },

  saveAsCopy: async () => {
    set({
      projectId: null, remoteName: '', revision: '', shareUrl: null,
      generation: ++nextGeneration, saving: false, saveError: null, saveConflict: false,
    });
    return get().save();
  },

  overwriteRemote: async () => {
    // Clearing the hash bypasses the clean-document fast path: overwrite is an
    // explicit user choice even when their local bytes have not changed.
    set({ revision: '', lastSavedHash: '', saveError: null, saveConflict: false });
    return get().save();
  },

  loadProject: async (provider, externalId, name) => {
    const generation = ++nextGeneration;
    set({ generation, saving: false, saveError: null, saveConflict: false });
    const identity = authIdentity();
    const accessToken = await useAuthStore.getState().getAccessToken();
    const storage = getStorageProvider(provider);
    const remote = await storage.read(accessToken, externalId);
    const body = decodeProjectDocument(remote, name || 'Untitled');

    let shareUrl: string | null = null;
    try {
      if (provider === 'github') {
        // Gists are always URL-accessible; share URL exists by definition.
        shareUrl = buildShareUrl(provider, externalId);
      } else if (await storage.isPublic(accessToken, externalId)) {
        shareUrl = buildShareUrl(provider, externalId);
      }
    } catch { /* sharing state best-effort */ }

    if (get().generation !== generation || authIdentity() !== identity) return;

    useModelerStore.getState().resetDocument(body.tree, name || 'Untitled');
    useChatStore.getState().clearMessages();

    set({
      provider,
      projectId: externalId,
      remoteName: name,
      lastSavedHash: bodyHash(),
      revision: remote.revision ?? '',
      shareUrl,
    });
    if (body.thumbnail) void putThumbnail(thumbnailKey(provider, externalId), body.thumbnail);
  },

  createProject: () => {
    const generation = ++nextGeneration;
    useModelerStore.getState().resetDocument(null, 'Untitled');
    useChatStore.getState().clearMessages();
    set({
      projectId: null,
      provider: null,
      remoteName: '',
      lastSavedHash: bodyHash(),
      shareUrl: null,
      saveError: null,
      saveConflict: false,
      revision: '',
      generation,
      saving: false,
    });
  },

  loadLocalDocument: (name, tree) => {
    const generation = ++nextGeneration;
    const modeler = useModelerStore.getState();
    modeler.resetDocument(decodeTree(tree, { legacy: true, repairMissingIds: true }), name || 'Untitled');
    useChatStore.getState().clearMessages();
    set({
      projectId: null,
      provider: null,
      remoteName: '',
      lastSavedHash: bodyHash(),
      shareUrl: null,
      saveError: null,
      saveConflict: false,
      revision: '',
      generation,
      saving: false,
    });
  },

  toggleShare: async () => {
    const { projectId, provider, shareUrl } = get();
    if (!projectId || !provider) return;
    const accessToken = await useAuthStore.getState().getAccessToken();
    const storage = getStorageProvider(provider);
    if (provider === 'google') {
      const makePublic = !shareUrl;
      await storage.setPublic(accessToken, projectId, makePublic);
      set({ shareUrl: makePublic ? buildShareUrl(provider, projectId) : null });
    } else {
      // Secret gists remain URL-accessible. Never clear the UI and imply that
      // an old URL stopped working; deleting the gist is the revocation path.
      if (!shareUrl) set({ shareUrl: buildShareUrl(provider, projectId) });
    }
  },
}));

if (editChannel) {
  editChannel.onmessage = (event: MessageEvent<CloudEditNotice>) => {
    const notice = event.data;
    const state = useProjectStore.getState();
    if (!notice || notice.account !== accountKey(notice.provider)) return;
    if (state.provider === notice.provider && state.projectId === notice.externalId &&
        state.revision && notice.revision !== state.revision) {
      useProjectStore.setState({
        saveConflict: true,
        saveError: 'This project was saved in another tab. Reload it or save your work as a copy.',
      });
    }
  };
}

export async function deleteCloudProject(provider: ProviderName, externalId: string): Promise<void> {
  const accessToken = await useAuthStore.getState().getAccessToken();
  const storage = getStorageProvider(provider);
  await storage.delete(accessToken, externalId);
  await deleteThumbnail(thumbnailKey(provider, externalId));
  const active = useProjectStore.getState();
  if (active.provider === provider && active.projectId === externalId) {
    useProjectStore.setState({
      provider: null, projectId: null, remoteName: '', revision: '', shareUrl: null,
      lastSavedHash: '', saving: false, generation: ++nextGeneration,
    });
  }
}

export async function loadThumbnail(provider: ProviderName, externalId: string): Promise<string | null> {
  return getThumbnail(thumbnailKey(provider, externalId));
}

// Auto-save: every 30 seconds, save if dirty.
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave() {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(() => {
    const { projectId } = useProjectStore.getState();
    if (projectId && isCloudDirty()) {
      void useProjectStore.getState().save();
    }
  }, 30000);
}

export function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}
