import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDrawer } from './ChatDrawer';
import { useChatStore } from '../../store/chatStore';

vi.mock('../mobile/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

describe('AI model proposal preview', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    useChatStore.setState({
      isOpen: true,
      isLoading: false,
      messages: [{ role: 'assistant', content: 'I prepared the change.' }],
      proposalError: null,
      pendingProposal: {
        tree: null,
        baseHash: 'null',
        summary: ['Update Box', 'Add a child to Union'],
        affectedNodeIds: ['box', 'union'],
      },
    });
  });

  it('shows the affected changes and lets the user discard them', () => {
    render(<ChatDrawer />);

    expect(screen.getByText('Review proposed model changes')).toBeInTheDocument();
    expect(screen.getByText('Update Box')).toBeInTheDocument();
    expect(screen.getByText('2 affected nodes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useChatStore.getState().pendingProposal).toBeNull();
  });
});
