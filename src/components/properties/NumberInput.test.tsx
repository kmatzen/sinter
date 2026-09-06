import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput } from './NumberInput';

describe('NumberInput constraints', () => {
  it('clamps keyboard stepping at the same minimum as typed input', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Scale" value={0.01} min={0.01} step={0.1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('Scale'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith(0.01);
  });

  it('clamps keyboard stepping at a maximum', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Count" value={50} min={2} max={50} step={1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('Count'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(50);
  });
});
