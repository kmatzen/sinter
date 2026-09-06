import { create } from 'zustand';
import { useModelerStore } from './modelerStore';
import { useAuthStore, getCurrentProvider } from './authStore';
import { captureCanvasThumbnail } from '../utils/thumbnail';
import { StorageConflictError, getStorageProvider, buildShareUrl, type ProviderName, type ProjectFileBody, type ProjectCheckpoint } from '../storage';
import { getThumbnail, putThumbnail, deleteThumbnail, thumbnailCacheKey } from '../storage/thumbnailCache';
import { useChatStore } from './chatStore';
import { useModalStore } from './modalStore';
import { decodeProjectDocument, decodeTree } from '../types/documentDecoder';
import type { NamedParameter, SDFNodeUI } from '../types/operations';
import type { NamedProjectView } from '../types/view';
import { useViewportStore } from './viewportStore';

const MAX_CHECKPOINTS = 10;
export type LiveCheckpoint = ProjectCheckpoint & { tree: SDFNodeUI | null };

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
  checkpoints: LiveCheckpoint[];
  lastSavedTree: SDFNodeUI | null;
  lastSavedThumbnail: string | null;
  lastSavedParameters: NamedParameter[];
  lastSavedViews: NamedProjectView[];

  setProjectId: (id: string | null, provider?: ProviderName | null) => void;
  save: () => Promise<boolean>;
  loadProject: (provider: ProviderName, externalId: string, name: string) => Promise<void>;
  loadLocalDocument: (name: string, tree: unknown, parameters?: NamedParameter[], views?: NamedProjectView[]) => void;
  createProject: () => void;
  toggleShare: () => Promise<void>;
  clearSaveError: () => void;
  reloadRemote: () => Promise<void>;
  saveAsCopy: () => Promise<boolean>;
  overwriteRemote: () => Promise<boolean>;
  createCheckpoint: (name: string) => Promise<boolean>;
  restoreCheckpoint: (id: string) => Promise<boolean>;
  deleteCheckpoint: (id: string) => Promise<boolean>;
}

function bodyHash(): string {
  const { tree, projectName, namedParameters } = useModelerStore.getState();
  return JSON.stringify({ tree, projectName, namedParameters, views: useViewportStore.getState().namedViews });
}

function sameTree(a: SDFNodeUI | null, b: SDFNodeUI | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function appendCheckpoint(checkpoints: LiveCheckpoint[], checkpoint: LiveCheckpoint): LiveCheckpoint[] {
  return [...checkpoints, checkpoint].slice(-MAX_CHECKPOINTS);
}

function checkpoint(name: string, tree: SDFNodeUI | null, parameters: NamedParameter[], views: NamedProjectView[]): LiveCheckpoint {
  return { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), tree, parameters, views };
}

function projectBody(tree: SDFNodeUI | null, thumbnail: string | null, checkpoints: LiveCheckpoint[], parameters: NamedParameter[], views: NamedProjectView[]): ProjectFileBody {
  return { version: 2, thumbnail, tree, checkpoints, parameters, views };
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

function cloudConversationKey(provider: ProviderName, externalId: string): string {
  return `cloud:${accountKey(provider)}:${externalId}`;
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
  checkpoints: [],
  lastSavedTree: null,
  lastSavedThumbnail: null,
  lastSavedParameters: [],
  lastSavedViews: [],

  setProjectId: (id, provider) => set({
    projectId: id, provider: provider ?? null, revision: '', generation: ++nextGeneration,
    checkpoints: [], lastSavedTree: null, lastSavedThumbnail: null, lastSavedParameters: [], lastSavedViews: [],
  }),

  clearSaveError: () => set({ saveError: null, saveConflict: false }),

  save: async () => {
    const { saving, projectId, provider, remoteName, revision, generation, checkpoints, lastSavedTree, lastSavedParameters, lastSavedViews } = get();
    if (saving) return false;

    const hash = bodyHash();
    if (hash === get().lastSavedHash && projectId) return true;

    set({ saving: true, saveError: null, saveConflict: false });
    const identity = authIdentity();
    try {
      const { projectName, tree, namedParameters } = useModelerStore.getState();
      const views = useViewportStore.getState().namedViews;
      const thumbnail = captureCanvasThumbnail();
      const savedAt = new Date().toISOString();
      const definitionsChanged = JSON.stringify(lastSavedParameters) !== JSON.stringify(namedParameters);
      const viewsChanged = JSON.stringify(lastSavedViews) !== JSON.stringify(views);
      const nextCheckpoints = projectId && (!sameTree(lastSavedTree, tree) || definitionsChanged || viewsChanged)
        ? appendCheckpoint(checkpoints, checkpoint(`Autosave ${savedAt}`, lastSavedTree, lastSavedParameters, lastSavedViews))
        : checkpoints;
      const body = projectBody(tree, thumbnail, nextCheckpoints, namedParameters, views);

      const activeProvider = provider ?? getCurrentProvider();
      if (!activeProvider) throw new Error('Sign in to save to cloud');
      const accessToken = await useAuthStore.getState().getAccessToken();
      const storage = getStorageProvider(activeProvider);

      let externalId = projectId;
      let savedRevision = revision;
      if (externalId) {
        const updated = await storage.update(accessToken, externalId, body, savedRevision);
        savedRevision = updated?.revision ?? savedRevision;
        // The content write is already committed remotely. Preserve its new
        // revision before attempting metadata so a failed rename can retry
        // against our own latest write instead of reporting a false conflict.
        if (get().generation !== generation || authIdentity() !== identity) return false;
        set({ revision: savedRevision, checkpoints: nextCheckpoints, lastSavedTree: tree, lastSavedThumbnail: thumbnail, lastSavedParameters: namedParameters, lastSavedViews: views });
        if (projectName !== remoteName) {
          const renamed = await storage.rename(accessToken, externalId, projectName, savedRevision);
          savedRevision = renamed?.revision ?? savedRevision;
        }
      } else {
        const result = await storage.create(accessToken, projectName, body);
        externalId = result.externalId;
        savedRevision = result.revision ?? '';
      }

      // Opening/creating another document or changing accounts invalidates
      // every completion from this operation. The remote copy may exist, but
      // it must never attach its identity or clean state to a different tree.
      if (get().generation !== generation || authIdentity() !== identity) return false;

      const wasNew = !projectId;
      set({
        provider: activeProvider,
        projectId: externalId,
        remoteName: projectName,
        lastSavedHash: hash,
        revision: savedRevision,
        checkpoints: nextCheckpoints,
        lastSavedTree: tree,
        lastSavedThumbnail: thumbnail,
        lastSavedParameters: namedParameters,
        lastSavedViews: views,
        saveConflict: false,
      });
      if (wasNew) useChatStore.getState().bindConversation(cloudConversationKey(activeProvider, externalId));
      announceEdit(activeProvider, externalId, savedRevision);
      // This is a disposable local cache, not part of the cloud transaction.
      // Failing to cache a preview must never turn a committed provider write
      // into a failed save or hide a newly created remote project identity.
      if (thumbnail) {
        try { await putThumbnail(thumbnailKey(activeProvider, externalId), thumbnail); }
        catch (error) { console.warn('Thumbnail cache write failed:', error); }
      }
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
    useChatStore.getState().stopGeneration();
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

    useModelerStore.getState().resetDocument(body.tree, name || 'Untitled', body.parameters);
    useViewportStore.getState().setNamedViews(body.views);
    useChatStore.getState().switchConversation(cloudConversationKey(provider, externalId));

    set({
      provider,
      projectId: externalId,
      remoteName: name,
      lastSavedHash: bodyHash(),
      revision: remote.revision ?? '',
      shareUrl,
      checkpoints: body.checkpoints,
      lastSavedTree: body.tree,
      lastSavedThumbnail: body.thumbnail,
      lastSavedParameters: body.parameters,
      lastSavedViews: body.views,
    });
    if (body.thumbnail) void putThumbnail(thumbnailKey(provider, externalId), body.thumbnail);
  },

  createProject: () => {
    const generation = ++nextGeneration;
    useModelerStore.getState().resetDocument(null, 'Untitled');
    useViewportStore.getState().setNamedViews([]);
    useChatStore.getState().switchConversation(`draft:${crypto.randomUUID()}`);
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
      checkpoints: [],
      lastSavedTree: null,
      lastSavedThumbnail: null,
      lastSavedParameters: [],
      lastSavedViews: [],
    });
  },

  loadLocalDocument: (name, tree, parameters = [], views = []) => {
    const generation = ++nextGeneration;
    const modeler = useModelerStore.getState();
    modeler.resetDocument(decodeTree(tree, { legacy: true, repairMissingIds: true }), name || 'Untitled', parameters);
    useViewportStore.getState().setNamedViews(views);
    useChatStore.getState().switchConversation('browser:default');
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
      checkpoints: [],
      lastSavedTree: null,
      lastSavedThumbnail: null,
      lastSavedParameters: [],
      lastSavedViews: [],
    });
  },

  createCheckpoint: async (name) => {
    const cleanName = name.trim().slice(0, 256);
    const { projectId, provider, revision, generation, saving, checkpoints, lastSavedTree, lastSavedParameters, lastSavedViews } = get();
    if (!cleanName || !projectId || !provider || saving) return false;
    set({ saving: true, saveError: null, saveConflict: false });
    const identity = authIdentity();
    try {
      const { tree, namedParameters } = useModelerStore.getState();
      const views = useViewportStore.getState().namedViews;
      const definitionsChanged = JSON.stringify(lastSavedParameters) !== JSON.stringify(namedParameters);
      const viewsChanged = JSON.stringify(lastSavedViews) !== JSON.stringify(views);
      const withPrevious = !sameTree(lastSavedTree, tree) || definitionsChanged || viewsChanged
        ? appendCheckpoint(checkpoints, checkpoint('Before named version', lastSavedTree, lastSavedParameters, lastSavedViews))
        : checkpoints;
      const nextCheckpoints = appendCheckpoint(withPrevious, checkpoint(cleanName, tree, namedParameters, views));
      const thumbnail = captureCanvasThumbnail();
      const accessToken = await useAuthStore.getState().getAccessToken();
      const result = await getStorageProvider(provider).update(accessToken, projectId, projectBody(tree, thumbnail, nextCheckpoints, namedParameters, views), revision);
      if (get().generation !== generation || authIdentity() !== identity) return false;
      set({
        checkpoints: nextCheckpoints, lastSavedTree: tree, lastSavedThumbnail: thumbnail, lastSavedParameters: namedParameters, lastSavedViews: views, revision: result?.revision ?? revision,
        lastSavedHash: bodyHash(), saveError: null, saveConflict: false,
      });
      announceEdit(provider, projectId, result?.revision ?? revision);
      return true;
    } catch (err: unknown) {
      if (get().generation === generation) set({
        saveError: err instanceof Error ? err.message : 'Checkpoint failed',
        saveConflict: err instanceof StorageConflictError || (err instanceof Error && err.name === 'StorageConflictError'),
      });
      return false;
    } finally {
      if (get().generation === generation) set({ saving: false });
    }
  },

  restoreCheckpoint: async (id) => {
    const { projectId, provider, revision, generation, saving, checkpoints } = get();
    const target = checkpoints.find((item) => item.id === id);
    if (!target || !projectId || !provider || saving) return false;
    set({ saving: true, saveError: null, saveConflict: false });
    const identity = authIdentity();
    try {
      const modeler = useModelerStore.getState();
      const currentViews = useViewportStore.getState().namedViews;
      const recovery = checkpoint(`Before restoring ${target.name}`, modeler.tree, modeler.namedParameters, currentViews);
      const nextCheckpoints = appendCheckpoint(checkpoints, recovery);
      const accessToken = await useAuthStore.getState().getAccessToken();
      const targetParameters = target.parameters ?? [];
      // Old v2 checkpoints predate view snapshots. Preserve the current set for
      // those files instead of inventing an empty historical state.
      const targetViews = target.views ?? currentViews;
      const result = await getStorageProvider(provider).update(accessToken, projectId, projectBody(target.tree, null, nextCheckpoints, targetParameters, targetViews), revision);
      if (get().generation !== generation || authIdentity() !== identity) return false;
      modeler.resetDocument(target.tree, modeler.projectName, targetParameters);
      useViewportStore.getState().setNamedViews(targetViews);
      set({
        checkpoints: nextCheckpoints, lastSavedTree: target.tree, lastSavedThumbnail: null, lastSavedParameters: targetParameters, lastSavedViews: targetViews, revision: result?.revision ?? revision,
        lastSavedHash: bodyHash(), saveError: null, saveConflict: false,
      });
      announceEdit(provider, projectId, result?.revision ?? revision);
      return true;
    } catch (err: unknown) {
      if (get().generation === generation) set({
        saveError: err instanceof Error ? err.message : 'Restore failed',
        saveConflict: err instanceof StorageConflictError || (err instanceof Error && err.name === 'StorageConflictError'),
      });
      return false;
    } finally {
      if (get().generation === generation) set({ saving: false });
    }
  },

  deleteCheckpoint: async (id) => {
    const { projectId, provider, revision, generation, saving, checkpoints, lastSavedTree, lastSavedThumbnail, lastSavedParameters, lastSavedViews } = get();
    if (!projectId || !provider || saving || !checkpoints.some((item) => item.id === id)) return false;
    set({ saving: true, saveError: null, saveConflict: false });
    const identity = authIdentity();
    try {
      const nextCheckpoints = checkpoints.filter((item) => item.id !== id);
      const accessToken = await useAuthStore.getState().getAccessToken();
      const result = await getStorageProvider(provider).update(accessToken, projectId, projectBody(lastSavedTree, lastSavedThumbnail, nextCheckpoints, lastSavedParameters, lastSavedViews), revision);
      if (get().generation !== generation || authIdentity() !== identity) return false;
      set({
        checkpoints: nextCheckpoints, revision: result?.revision ?? revision,
        saveError: null, saveConflict: false,
      });
      announceEdit(provider, projectId, result?.revision ?? revision);
      return true;
    } catch (err: unknown) {
      if (get().generation === generation) set({
        saveError: err instanceof Error ? err.message : 'Checkpoint deletion failed',
        saveConflict: err instanceof StorageConflictError || (err instanceof Error && err.name === 'StorageConflictError'),
      });
      return false;
    } finally {
      if (get().generation === generation) set({ saving: false });
    }
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
      checkpoints: [], lastSavedTree: null,
      lastSavedThumbnail: null, lastSavedParameters: [], lastSavedViews: [],
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
