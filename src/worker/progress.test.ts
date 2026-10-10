import { describe, expect, it, vi } from 'vitest';
import { deduplicatedProgress } from './progress';

describe('worker progress deduplication', () => {
  it('emits only visible integer changes while preserving stage transitions', () => {
    const emit = vi.fn();
    const progress = deduplicatedProgress(emit);
    progress('Evaluating', 10.1);
    progress('Evaluating', 10.2);
    progress('Evaluating', 10.49);
    progress('Evaluating', 10.51);
    progress('Meshing', 10.51);

    expect(emit.mock.calls).toEqual([
      ['Evaluating', 10],
      ['Evaluating', 11],
      ['Meshing', 11],
    ]);
  });

  it('clamps malformed producer percentages to the protocol range', () => {
    const emit = vi.fn();
    const progress = deduplicatedProgress(emit);
    progress('A', -20);
    progress('A', 120);
    expect(emit.mock.calls).toEqual([['A', 0], ['A', 100]]);
  });
});
