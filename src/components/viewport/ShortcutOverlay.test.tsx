import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShortcutOverlay } from './ShortcutOverlay';

describe('ShortcutOverlay touch entry point', () => {
  it('uses the shared mobile touch-target contract', () => {
    render(<ShortcutOverlay />);
    expect(screen.getByRole('button', { name: /open keyboard shortcuts and accessibility help/i })).toHaveClass('tap');
  });

  it('opens and closes without requiring a keyboard', () => {
    render(<ShortcutOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /open keyboard shortcuts and accessibility help/i }));
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    expect(screen.getByText(/keyboard and screen-reader alternative/i)).toBeInTheDocument();
    expect(screen.getByText('Add or remove a shape from the selection')).toBeInTheDocument();
    expect(screen.getByText('Add or remove a shape on touch screens')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close keyboard shortcuts/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
