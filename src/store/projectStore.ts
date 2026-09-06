import { create } from 'zustand';
import { useModelerStore } from './modelerStore';
import { useAuthStore, getCurrentProvider } from './authStore';
import { captureCanvasThumbnail } from '../utils/thumbnail';
import { getStorageProvider, buildShareUrl, type ProviderName, type ProjectFileBody } from '../storage';
import { getThumbnail, putThumbnail, deleteThumbnail } from '../storage/thumbnailCache';
import { useChatStore } from './chatStore';
import { useModalStore } from './modalStore';
import { decodeProjectDocument, decodeTree } from '../types/documentDecoder';

interface ProjectState {
  provider: ProviderName | null;
  projectId: string | null; // external ID at the provider
  /** Name last persisted at the provider (so we know whether to call rename). */
  remoteName: string;
  lastSavedHash: string;
  saving: boolean;
  saveError: string | null;
  /** App share URL (origin + /shared#...) when this project is shareable, else null. */
  shareUrl: string | null;

  setProjectId: (id: string | null, provider?: ProviderName | null) => void;
  save: () => Promise<boolean>;
  loadProject: (provider: ProviderName, externalId: string, name: string) => Promise<void>;
  loadLocalDocument: (name: string, tree: unknown) => void;
  createProject: () => void;
  toggleShare: () => Promise<void>;
  clearSaveError: () => void;
}

function bodyHash(): string {
  const { tree, projectName } = useModelerStore.getState();
  return JSON.stringify({ tree, projectName });
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
  saving: false,
  saveError: null,
  shareUrl: null,

  setProjectId: (id, provider) => set({ projectId: id, provider: provider ?? null }),

  clearSaveError: () => set({ saveError: null }),

  save: async () => {
    const { saving, projectId, provider, remoteName } = get();
    if (saving) return false;

    const hash = bodyHash();
    if (hash === get().lastSavedHash && projectId) return true;

    set({ saving: true, saveError: null });
    try {
      const { projectName, tree } = useModelerStore.getState();
      const thumbnail = captureCanvasThumbnail();
      const body: ProjectFileBody = { version: 1, thumbnail, tree };

      const activeProvider = provider ?? getCurrentProvider();
      if (!activeProvider) throw new Error('Sign in to save to cloud');
      const accessToken = await useAuthStore.getState().getAccessToken();
      const storage = getStorageProvider(activeProvider);

      let externalId = projectId;
      if (externalId) {
        await storage.update(accessToken, externalId, body);
        if (projectName !== remoteName) {
          await storage.rename(accessToken, externalId, projectName);
        }
      } else {
        const result = await storage.create(accessToken, projectName, body);
        externalId = result.externalId;
      }

      if (thumbnail) await putThumbnail(externalId, thumbnail);

      set({
        provider: activeProvider,
        projectId: externalId,
        remoteName: projectName,
        lastSavedHash: hash,
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed';
      console.error('Save failed:', err);
      set({ saveError: message });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  loadProject: async (provider, externalId, name) => {
    const accessToken = await useAuthStore.getState().getAccessToken();
    const storage = getStorageProvider(provider);
    const body = decodeProjectDocument(await storage.read(accessToken, externalId), name || 'Untitled');

    const modeler = useModelerStore.getState();
    modeler.resetDocument(
      body.tree,
      name || 'Untitled',
    );
    useChatStore.getState().clearMessages();

    if (body?.thumbnail) await putThumbnail(externalId, body.thumbnail);

    let shareUrl: string | null = null;
    try {
      if (provider === 'github') {
        // Gists are always URL-accessible; share URL exists by definition.
        shareUrl = buildShareUrl(provider, externalId);
      } else if (await storage.isPublic(accessToken, externalId)) {
        shareUrl = buildShareUrl(provider, externalId);
      }
    } catch { /* sharing state best-effort */ }

    set({
      provider,
      projectId: externalId,
      remoteName: name,
      lastSavedHash: bodyHash(),
      shareUrl,
    });
  },

  createProject: () => {
    useModelerStore.getState().resetDocument(null, 'Untitled');
    useChatStore.getState().clearMessages();
    set({
      projectId: null,
      provider: null,
      remoteName: '',
      lastSavedHash: bodyHash(),
      shareUrl: null,
      saveError: null,
    });
  },

  loadLocalDocument: (name, tree) => {
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

export async function deleteCloudProject(provider: ProviderName, externalId: string): Promise<void> {
  const accessToken = await useAuthStore.getState().getAccessToken();
  const storage = getStorageProvider(provider);
  await storage.delete(accessToken, externalId);
  await deleteThumbnail(externalId);
}

export async function loadThumbnail(externalId: string): Promise<string | null> {
  return getThumbnail(externalId);
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
