import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreeEngine } from '../../engine/ThreeEngine';
import { useViewportStore } from '../../store/viewportStore';
import { ViewportToolbar } from './ViewportToolbar';

describe('ViewportToolbar camera controls', () => {
  beforeEach(() => {
    useViewportStore.setState({ clipEnabled: false, measurementMode: false, showDimensions: false, projection: 'perspective' });
  });

  it('offers every exact standard view in one compact control', () => {
    const setStandardView = vi.fn();
    render(<ViewportToolbar engine={{ setStandardView } as unknown as ThreeEngine} />);
    const select = screen.getByLabelText('Standard view');
    for (const name of ['Isometric', 'Front', 'Back', 'Right', 'Left', 'Top', 'Bottom']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    fireEvent.change(select, { target: { value: 'top' } });
    expect(setStandardView).toHaveBeenCalledWith('top');
  });

  it('exposes frame-all and frame-selection commands', () => {
    const zoomToFit = vi.fn();
    const frameSelection = vi.fn();
    render(<ViewportToolbar engine={{ zoomToFit, frameSelection } as unknown as ThreeEngine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Frame all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Frame selection' }));
    expect(zoomToFit).toHaveBeenCalledTimes(1);
    expect(frameSelection).toHaveBeenCalledTimes(1);
  });

  it('offers a compact perspective/orthographic toggle', () => {
    render(<ViewportToolbar engine={null} />);
    fireEvent.click(screen.getByRole('button', { name: /projection: perspective/i }));
    expect(useViewportStore.getState().projection).toBe('orthographic');
    expect(screen.getByRole('button', { name: /projection: orthographic/i })).toHaveTextContent('O');
  });
});
