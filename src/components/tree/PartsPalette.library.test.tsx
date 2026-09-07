import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SDFNodeUI } from '../../types/operations';
import { useModelerStore } from '../../store/modelerStore';
import { PartsPalette } from './PartsPalette';

const box: SDFNodeUI = { id: 'box', kind: 'box', label: 'Fixture', params: { width: 20, height: 10, depth: 5 }, children: [], enabled: true };

describe('PartsPalette personal library', () => {
  beforeEach(() => {
    localStorage.clear();
    useModelerStore.getState().resetDocument(box);
    useModelerStore.getState().selectNode('box');
  });

  it('saves through an accessible inline form and inserts as one undoable copy', () => {
    render(<PartsPalette />);
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Component name' }), { target: { value: 'Bench fixture' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Component description' }), { target: { value: 'Reusable jig' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Component tags' }), { target: { value: 'shop, jig' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('status')).toHaveTextContent('Saved Bench fixture');
    const historyBefore = useModelerStore.getState().history.length;
    fireEvent.click(screen.getByTitle('Insert Bench fixture as a copy'));
    expect(useModelerStore.getState().history.length).toBe(historyBefore + 1);
    expect(screen.getByRole('status')).toHaveTextContent('independent copy');
  });
});
