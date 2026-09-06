import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';

describe('AI formula context', () => {
  it('includes named definitions and persistent formula sources', () => {
    const prompt = buildSystemPrompt({
      id: 'box', kind: 'box', label: 'Box', params: { width: 24, height: 10, depth: 10 },
      expressions: { width: 'opening + 2 * wall' }, children: [], enabled: true,
    }, [
      { name: 'opening', expression: '20', unit: 'mm' },
      { name: 'wall', expression: '2', unit: 'mm' },
    ]);
    expect(prompt).toContain('"name": "wall"');
    expect(prompt).toContain('"width": "opening + 2 * wall"');
    expect(prompt).toContain('Preserve existing expressions');
  });
});
