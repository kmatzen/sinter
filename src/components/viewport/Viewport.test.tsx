import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../engine/ThreeEngine', () => ({
  ThreeEngine: class ThreeEngine {
    constructor() { throw new Error('WebGL 2 context creation failed'); }
  },
}));
vi.mock('../../engine/engineRef', () => ({ setEngineRef: vi.fn() }));
vi.mock('./ViewportToolbar', () => ({ ViewportToolbar: () => null }));
vi.mock('./ShortcutOverlay', () => ({ ShortcutOverlay: () => null }));
vi.mock('./DimensionLabels', () => ({ DimensionLabels: () => null }));
vi.mock('./SelectionOverlay', () => ({ SelectionOverlay: () => null }));
vi.mock('./SelectionBreadcrumb', () => ({ SelectionBreadcrumb: () => null }));
vi.mock('./ModelErrorNotice', () => ({ ModelErrorNotice: () => null }));

import { Viewport } from './Viewport';

describe('Viewport capability failure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the editor mounted and explains how to restore the preview', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Viewport />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('3D preview unavailable');
    expect(alert).toHaveTextContent('WebGL 2');
    expect(alert).toHaveTextContent('hardware acceleration');
    expect(alert).toHaveTextContent('WebGL 2 context creation failed');
  });
});
