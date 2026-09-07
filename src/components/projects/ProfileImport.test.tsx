import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileImport } from './ProfileImport';

describe('ProfileImport', () => {
  afterEach(cleanup);

  it('previews dimensions and warnings before one explicit commit', async () => {
    const commit = vi.fn();
    render(<ProfileImport revolve={false} onCommit={commit} />);
    const file = { name: 'plate.svg', text: async () => '<svg width="20mm"><rect width="20" height="10"/><text>note</text></svg>' } as File;
    fireEvent.change(screen.getByLabelText('Import profile file'), { target: { files: [file] } });
    expect(await screen.findByRole('status')).toHaveTextContent('20.00 × 10.00 mm');
    expect(screen.getByLabelText('Curve chord tolerance')).toHaveValue(0.25);
    expect(screen.getByRole('note')).toHaveTextContent('Unsupported SVG entities ignored: text');
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Use imported profile'));
    expect(commit).toHaveBeenCalledOnce();
  });

  it('reparses curves at a user-selected chord tolerance', async () => {
    render(<ProfileImport revolve={false} onCommit={() => {}} />);
    const file = { name: 'curve.svg', text: async () => '<svg><path d="M0 0 Q10 20 20 0 L0 0 Z"/></svg>' } as File;
    fireEvent.change(screen.getByLabelText('Import profile file'), { target: { files: [file] } });
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Curve chord tolerance'), { target: { value: '1' } });
    expect(screen.getByLabelText('Curve chord tolerance')).toHaveValue(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('updates dimensions when source units are overridden', async () => {
    render(<ProfileImport revolve={false} onCommit={() => {}} />);
    const file = { name: 'plate.svg', text: async () => '<svg><rect width="96" height="48"/></svg>' } as File;
    fireEvent.change(screen.getByLabelText('Import profile file'), { target: { files: [file] } });
    expect(await screen.findByRole('status')).toHaveTextContent('25.40 × 12.70 mm');
    fireEvent.change(screen.getByLabelText('Profile source units'), { target: { value: 'mm' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('96.00 × 48.00 mm'));
  });

  it('blocks a negative-radius profile for revolve', async () => {
    render(<ProfileImport revolve onCommit={() => {}} />);
    const file = { name: 'knob.svg', text: async () => '<svg><rect x="-1" y="0" width="10" height="5"/></svg>' } as File;
    fireEvent.change(screen.getByLabelText('Import profile file'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('radius coordinates must be non-negative');
    expect(screen.queryByText('Use imported profile')).not.toBeInTheDocument();
  });
});
