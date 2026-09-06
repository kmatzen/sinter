import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleModelerKeyDown } from './modelerShortcuts';
import { useProjectStore } from './store/projectStore';
import { setEngineRef } from './engine/engineRef';
import type { ThreeEngine } from './engine/ThreeEngine';

describe('modeler save shortcut', () => {
  const originalSave = useProjectStore.getState().save;

  afterEach(() => {
    useProjectStore.setState({ save: originalSave });
    setEngineRef(null);
  });

  for (const modifier of ['metaKey', 'ctrlKey'] as const) {
    it(`routes ${modifier === 'metaKey' ? 'Cmd' : 'Ctrl'}+S to the application save`, () => {
      const save = vi.fn(async () => true);
      useProjectStore.setState({ save });
      const event = new KeyboardEvent('keydown', {
        key: 's',
        [modifier]: true,
        cancelable: true,
      });

      handleModelerKeyDown(event);

      expect(event.defaultPrevented).toBe(true);
      expect(save).toHaveBeenCalledOnce();
    });
  }

  it('wins over browser save while a text field has focus', () => {
    const save = vi.fn(async () => true);
    useProjectStore.setState({ save });
    const event = new KeyboardEvent('keydown', { key: 'S', metaKey: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.createElement('input') });

    handleModelerKeyDown(event);

    expect(event.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('frames all or the selection with F and Shift+F', () => {
    const zoomToFit = vi.fn();
    const frameSelection = vi.fn();
    setEngineRef({ zoomToFit, frameSelection } as unknown as ThreeEngine);
    const all = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    const selected = new KeyboardEvent('keydown', { key: 'F', shiftKey: true, cancelable: true });
    handleModelerKeyDown(all);
    handleModelerKeyDown(selected);
    expect(all.defaultPrevented).toBe(true);
    expect(selected.defaultPrevented).toBe(true);
    expect(zoomToFit).toHaveBeenCalledOnce();
    expect(frameSelection).toHaveBeenCalledOnce();
  });
});
