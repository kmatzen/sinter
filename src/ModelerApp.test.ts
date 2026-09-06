import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleModelerKeyDown } from './modelerShortcuts';
import { useProjectStore } from './store/projectStore';

describe('modeler save shortcut', () => {
  const originalSave = useProjectStore.getState().save;

  afterEach(() => {
    useProjectStore.setState({ save: originalSave });
  });

  for (const modifier of ['metaKey', 'ctrlKey'] as const) {
    it(`routes ${modifier === 'metaKey' ? 'Cmd' : 'Ctrl'}+S to the application save`, () => {
      const save = vi.fn(async () => {});
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
    const save = vi.fn(async () => {});
    useProjectStore.setState({ save });
    const event = new KeyboardEvent('keydown', { key: 'S', metaKey: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.createElement('input') });

    handleModelerKeyDown(event);

    expect(event.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });
});
