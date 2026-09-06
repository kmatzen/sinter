import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload } from '../../utils/download';
import { useModelerStore } from '../../store/modelerStore';
import { ModelErrorNotice } from './ModelErrorNotice';

vi.mock('../../utils/download', () => ({ triggerDownload: vi.fn() }));

const tree = (id: string) => ({
  id, kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true,
}) as any;

describe('ModelErrorNotice', () => {
  beforeEach(() => {
    vi.mocked(triggerDownload).mockReset();
    const current = tree('current');
    useModelerStore.setState({ tree: current, lastValidTree: tree('valid'), error: 'Worker failed' });
  });

  it('retries without adding an undo entry', () => {
    const before = useModelerStore.getState().history.length;
    const original = useModelerStore.getState().tree;
    render(<ModelErrorNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry evaluation' }));
    expect(useModelerStore.getState().tree).not.toBe(original);
    expect(useModelerStore.getState().history).toHaveLength(before);
    expect(useModelerStore.getState().error).toBeNull();
  });

  it('can revert to the last successfully evaluated model', () => {
    render(<ModelErrorNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Revert to last valid model' }));
    expect(useModelerStore.getState().tree?.id).toBe('valid');
  });

  it('downloads recovery without clearing the document', async () => {
    render(<ModelErrorNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Download recovery' }));
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledOnce());
    expect(useModelerStore.getState().tree?.id).toBe('current');
  });
});
