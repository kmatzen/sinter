import { describe, it, expect } from 'vitest';
import { parseResponse } from './parseResponse';

describe('parseResponse', () => {
  it('parses replace action with tree', () => {
    const response = `Here's a box:
\`\`\`json
{
  "action": "replace",
  "tree": { "id": "1", "kind": "box", "label": "Box", "params": { "width": 50, "height": 30, "depth": 50 }, "children": [], "enabled": true }
}
\`\`\``;

    const result = parseResponse(response);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('replace');
    if (result!.action === 'replace') {
      expect(result!.tree.kind).toBe('box');
      expect(result!.tree.params.width).toBe(50);
    }
  });

  it('parses modify action', () => {
    const response = `\`\`\`json
{
  "action": "modify",
  "changes": [
    { "update": "node-1", "params": { "width": 60 } }
  ]
}
\`\`\``;

    const result = parseResponse(response);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('modify');
  });

  it('parses bare tree node as replace', () => {
    const response = `{ "kind": "sphere", "params": { "radius": 10 }, "children": [] }`;
    const result = parseResponse(response);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('replace');
  });

  it('returns null for non-JSON response', () => {
    const result = parseResponse('I can help you with that! Let me think about it.');
    expect(result).toBeNull();
  });

  it('handles nested tree structures', () => {
    const response = `\`\`\`json
{
  "action": "replace",
  "tree": {
    "id": "root", "kind": "union", "label": "Union", "params": { "smooth": 3 }, "enabled": true,
    "children": [
      { "id": "a", "kind": "box", "label": "Box", "params": { "width": 10, "height": 10, "depth": 10 }, "children": [], "enabled": true },
      { "id": "b", "kind": "sphere", "label": "Sphere", "params": { "radius": 5 }, "children": [], "enabled": true }
    ]
  }
}
\`\`\``;

    const result = parseResponse(response);
    expect(result).not.toBeNull();
    if (result!.action === 'replace') {
      expect(result!.tree.children.length).toBe(2);
      expect(result!.tree.children[0].kind).toBe('box');
      expect(result!.tree.children[1].kind).toBe('sphere');
    }
  });

  it('assigns random IDs when missing', () => {
    const response = `{ "kind": "box", "params": { "width": 10, "height": 10, "depth": 10 }, "children": [] }`;
    const result = parseResponse(response);
    if (result!.action === 'replace') {
      expect(result!.tree.id).toBeDefined();
      expect(result!.tree.id.length).toBeGreaterThan(0);
    }
  });
});
