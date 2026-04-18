import { describe, it, expect } from 'vitest';
import { nodeSummary, expectedChildren, isPrimitive, isBoolean, incompleteNodeIds, NODE_DEFAULTS, NODE_LABELS } from './operations';
import type { SDFNodeUI } from './operations';

describe('operations types', () => {
  it('all node kinds have defaults', () => {
    const allKinds = Object.keys(NODE_LABELS);
    for (const kind of allKinds) {
      expect(NODE_DEFAULTS[kind]).toBeDefined();
    }
  });

  it('all node kinds have labels', () => {
    const allKinds = Object.keys(NODE_DEFAULTS);
    for (const kind of allKinds) {
      expect(NODE_LABELS[kind]).toBeDefined();
      expect(NODE_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('primitives have 0 expected children', () => {
    expect(expectedChildren('box')).toBe(0);
    expect(expectedChildren('sphere')).toBe(0);
    expect(expectedChildren('cylinder')).toBe(0);
    expect(expectedChildren('torus')).toBe(0);
  });

  it('booleans have 2 expected children', () => {
    expect(expectedChildren('union')).toBe(2);
    expect(expectedChildren('subtract')).toBe(2);
    expect(expectedChildren('intersect')).toBe(2);
  });

  it('modifiers have 1 expected child', () => {
    expect(expectedChildren('shell')).toBe(1);
    expect(expectedChildren('offset')).toBe(1);
    expect(expectedChildren('round')).toBe(1);
    expect(expectedChildren('mirror')).toBe(1);
    expect(expectedChildren('translate')).toBe(1);
  });

  it('isPrimitive returns correct values', () => {
    expect(isPrimitive('box')).toBe(true);
    expect(isPrimitive('sphere')).toBe(true);
    expect(isPrimitive('union')).toBe(false);
    expect(isPrimitive('shell')).toBe(false);
  });

  it('isBoolean returns correct values', () => {
    expect(isBoolean('union')).toBe(true);
    expect(isBoolean('subtract')).toBe(true);
    expect(isBoolean('box')).toBe(false);
  });

  it('nodeSummary generates readable text', () => {
    const box: SDFNodeUI = { id: '1', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true };
    expect(nodeSummary(box)).toContain('10');
    expect(nodeSummary(box)).toContain('20');
    expect(nodeSummary(box)).toContain('30');

    const sphere: SDFNodeUI = { id: '2', kind: 'sphere', label: 'Sphere', params: { radius: 5 }, children: [], enabled: true };
    expect(nodeSummary(sphere)).toContain('5');

    const union: SDFNodeUI = { id: '3', kind: 'union', label: 'Union', params: { smooth: 0 }, children: [], enabled: true };
    expect(nodeSummary(union)).toBe('sharp');

    const smoothUnion: SDFNodeUI = { id: '4', kind: 'union', label: 'Union', params: { smooth: 3 }, children: [], enabled: true };
    expect(nodeSummary(smoothUnion)).toContain('3');
  });

  it('incompleteNodeIds finds nodes missing children', () => {
    const box: SDFNodeUI = { id: 'b', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true };
    // A complete union
    const fullUnion: SDFNodeUI = { id: 'u1', kind: 'union', label: 'Union', params: { smooth: 0 }, children: [
      { id: 'b1', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true },
      { id: 'b2', kind: 'sphere', label: 'Sphere', params: { radius: 5 }, children: [], enabled: true },
    ], enabled: true };
    expect(incompleteNodeIds(fullUnion).size).toBe(0);

    // A union missing one child
    const partialUnion: SDFNodeUI = { id: 'u2', kind: 'union', label: 'Union', params: { smooth: 0 }, children: [box], enabled: true };
    const ids = incompleteNodeIds(partialUnion);
    expect(ids.has('u2')).toBe(true);
    expect(ids.size).toBe(1);

    // A modifier with no child
    const emptyShell: SDFNodeUI = { id: 's1', kind: 'shell', label: 'Shell', params: { thickness: 2 }, children: [], enabled: true };
    expect(incompleteNodeIds(emptyShell).has('s1')).toBe(true);

    // Disabled nodes are not flagged
    const disabledUnion: SDFNodeUI = { id: 'u3', kind: 'union', label: 'Union', params: { smooth: 0 }, children: [], enabled: false };
    expect(incompleteNodeIds(disabledUnion).size).toBe(0);

    // Null tree returns empty set
    expect(incompleteNodeIds(null).size).toBe(0);

    // Ancestors up to root are also flagged
    const deepIncomplete: SDFNodeUI = {
      id: 'root', kind: 'subtract', label: 'Subtract', params: { smooth: 0 }, enabled: true,
      children: [
        { id: 'shell', kind: 'shell', label: 'Shell', params: { thickness: 2 }, enabled: true, children: [] },
        { id: 'b3', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true },
      ],
    };
    const deepIds = incompleteNodeIds(deepIncomplete);
    expect(deepIds.has('shell')).toBe(true);  // directly incomplete
    expect(deepIds.has('root')).toBe(true);   // ancestor propagation
    expect(deepIds.has('b3')).toBe(false);    // valid sibling not flagged
  });
});
