import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

function Harness() {
  const [open, setOpen] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  useDialogFocus(surface, () => setOpen(false), open);
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    {open && (
      <div ref={surface} role="dialog" aria-modal="true">
        <button>First</button>
        <button>Last</button>
      </div>
    )}
  </>;
}

describe('useDialogFocus', () => {
  it('moves focus in, traps both tab directions, closes on Escape, and restores focus', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(first).toHaveFocus();

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
