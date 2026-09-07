import { beforeEach, describe, expect, it } from 'vitest';
import { componentParameters, createPersonalComponent, exportComponent, importComponent, readPersonalComponents, renamePersonalComponent } from './componentLibrary';
import type { SDFNodeUI } from '../types/operations';

const node: SDFNodeUI = {
  id: 'box-1', kind: 'box', label: 'Useful box', params: { width: 20, height: 10, depth: 5 }, children: [], enabled: true,
};

describe('personal component library', () => {
  beforeEach(() => localStorage.clear());

  it('saves a validated subtree with portable metadata and parameters', () => {
    const saved = createPersonalComponent(node, 'Fixture', 'Bench fixture', ['shop', 'Jig'], [
      { name: 'width', expression: '20', unit: 'mm' },
    ]);
    expect(readPersonalComponents()[0]).toMatchObject({ name: 'Fixture', description: 'Bench fixture', tags: ['shop', 'jig'] });
    expect(saved.thumbnail).toMatch(/^data:image\/svg\+xml/);
    expect(saved.node).not.toBe(node);
    expect(JSON.parse(exportComponent(saved))).toMatchObject({ version: 1, component: { name: 'Fixture' } });
  });

  it('defines duplicate-name behavior for save, rename, and import', () => {
    const saved = createPersonalComponent(node, 'Fixture', '', [], []);
    expect(() => createPersonalComponent(node, 'fixture', '', [], [])).toThrow(/already exists/);
    const second = createPersonalComponent({ ...node, id: 'box-2' }, 'Bracket', '', [], []);
    expect(() => renamePersonalComponent(second.id, 'Fixture')).toThrow(/already exists/);
    expect(() => importComponent(exportComponent(saved))).toThrow(/already exists/);
  });

  it('rejects malformed imported geometry at the document decoder boundary', () => {
    const malformed = JSON.stringify({ version: 1, component: { id: 'bad', name: 'Bad', description: '', tags: [], parameters: [], node: { ...node, kind: 'not-real' } } });
    expect(() => importComponent(malformed)).toThrow(/kind/);
    expect(readPersonalComponents()).toEqual([]);
  });

  it('declares only parameters reached by subtree expressions and their dependencies', () => {
    const expressed = { ...node, expressions: { width: 'outer - wall * 2' } };
    expect(componentParameters(expressed, [
      { name: 'outer', expression: 'base * 2', unit: 'mm' },
      { name: 'base', expression: '10', unit: 'mm' },
      { name: 'wall', expression: '2', unit: 'mm' },
      { name: 'unused', expression: '99', unit: 'mm' },
    ]).map((item) => item.name)).toEqual(['outer', 'base', 'wall']);
  });
});
