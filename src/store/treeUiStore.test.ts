import { beforeEach, describe, expect, it } from 'vitest';
import { useTreeUiStore } from './treeUiStore';
import { useModelerStore } from './modelerStore';

beforeEach(() => useTreeUiStore.getState().resetViewState());

describe('editor-only node organization state', () => {
  it('toggles lock and viewport visibility independently', () => {
    const state = useTreeUiStore.getState();
    state.toggleLocked('part');
    state.toggleHidden('part');
    expect(useTreeUiStore.getState().lockedNodeIds).toEqual(new Set(['part']));
    expect(useTreeUiStore.getState().hiddenNodeIds).toEqual(new Set(['part']));

    useTreeUiStore.getState().toggleLocked('part');
    expect(useTreeUiStore.getState().lockedNodeIds.size).toBe(0);
    expect(useTreeUiStore.getState().hiddenNodeIds).toEqual(new Set(['part']));
  });

  it('showAll clears viewport filters without unlocking nodes', () => {
    const state = useTreeUiStore.getState();
    state.toggleLocked('part');
    state.toggleHidden('part');
    state.isolate('other');
    useTreeUiStore.getState().showAll();

    expect(useTreeUiStore.getState()).toMatchObject({ isolatedNodeId: null });
    expect(useTreeUiStore.getState().hiddenNodeIds.size).toBe(0);
    expect(useTreeUiStore.getState().lockedNodeIds).toEqual(new Set(['part']));
  });

  it('clears stale node ids when the document is replaced', () => {
    const state = useTreeUiStore.getState();
    state.toggleLocked('old');
    state.toggleHidden('old');
    state.isolate('old');

    useModelerStore.getState().resetDocument(null);

    expect(useTreeUiStore.getState().lockedNodeIds.size).toBe(0);
    expect(useTreeUiStore.getState().hiddenNodeIds.size).toBe(0);
    expect(useTreeUiStore.getState().isolatedNodeId).toBeNull();
  });
});
