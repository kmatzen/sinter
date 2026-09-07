import type { NamedParameter } from './operations';

export interface NamedConfiguration {
  id: string;
  name: string;
  /** Parameter expressions overridden by this configuration, keyed by parameter name. */
  overrides: Record<string, string>;
}

export function parametersForConfiguration(base: NamedParameter[], configuration?: NamedConfiguration): NamedParameter[] {
  if (!configuration) return base.map((parameter) => ({ ...parameter }));
  return base.map((parameter) => ({
    ...parameter,
    expression: Object.prototype.hasOwnProperty.call(configuration.overrides, parameter.name)
      ? configuration.overrides[parameter.name]
      : parameter.expression,
  }));
}
