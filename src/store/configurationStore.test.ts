import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigurationStore } from './configurationStore';
import { useModelerStore } from './modelerStore';

const parameters = [
  { name: 'width', expression: '10', unit: 'mm' as const },
  { name: 'height', expression: 'width * 2', unit: 'mm' as const },
];

describe('configurationStore', () => {
  beforeEach(() => {
    useModelerStore.getState().resetDocument(null, 'Test', parameters);
    useConfigurationStore.getState().reset([], null, parameters);
  });

  it('switches only parameter values and restores the base definitions', () => {
    const historyLength = useModelerStore.getState().history.length;
    useConfigurationStore.getState().add('Wide');
    const id = useConfigurationStore.getState().configurations[0].id;
    useConfigurationStore.getState().setOverride(id, 'width', '25');
    useConfigurationStore.getState().activate(id);
    expect(useModelerStore.getState().namedParameters.map((item) => item.expression)).toEqual(['25', 'width * 2']);
    useConfigurationStore.getState().activate(null);
    expect(useModelerStore.getState().namedParameters).toEqual(parameters);
    expect(useModelerStore.getState().history).toHaveLength(historyLength);
    expect(useModelerStore.getState().parameterHistory[useModelerStore.getState().historyIndex]).toEqual(parameters);
  });

  it('rejects a broken override without corrupting the configuration', () => {
    useConfigurationStore.getState().add('Broken');
    const id = useConfigurationStore.getState().configurations[0].id;
    useConfigurationStore.getState().setOverride(id, 'width', 'missing + 1');
    expect(useConfigurationStore.getState().configurations[0].overrides).toEqual({});
    expect(useModelerStore.getState().error).toMatch(/missing/i);
  });

  it('removes overrides whose named parameter was deleted', () => {
    useConfigurationStore.getState().add('Wide');
    const id = useConfigurationStore.getState().configurations[0].id;
    useConfigurationStore.getState().setOverride(id, 'width', '20');
    useModelerStore.getState().setNamedParameters([{ name: 'height', expression: '20', unit: 'mm' }]);
    useConfigurationStore.getState().refreshBase();
    expect(useConfigurationStore.getState().configurations[0].overrides).toEqual({});
  });
});
