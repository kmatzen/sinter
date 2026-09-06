import type { NamedParameter, ParameterUnit, SDFNodeUI } from './operations';
import { applyNodeParamPatch, PARAMETER_SCHEMAS } from './parameterSchema';
import { toMillimeters } from './units';

interface Quantity { value: number; unit: ParameterUnit | null; bare: boolean }
type Lookup = (name: string) => Quantity;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_EXPRESSION_LENGTH = 512;

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: string[], private readonly lookup: Lookup) {}

  parse(): Quantity {
    if (!this.tokens.length) throw new FormulaError('Expression is empty');
    const result = this.expression();
    if (this.pos !== this.tokens.length) throw new FormulaError(`Unexpected token “${this.tokens[this.pos]}”`);
    if (!Number.isFinite(result.value)) throw new FormulaError('Expression result must be finite');
    return result;
  }

  private peek() { return this.tokens[this.pos]; }
  private take() { return this.tokens[this.pos++]; }

  private expression(): Quantity {
    let left = this.term();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.take();
      const right = this.term();
      const unit = compatibleAddUnit(left, right);
      left = { value: op === '+' ? left.value + right.value : left.value - right.value, unit, bare: left.bare && right.bare };
    }
    return left;
  }

  private term(): Quantity {
    let left = this.factor();
    while (this.peek() === '*' || this.peek() === '/' || isLengthUnit(this.peek())) {
      if (isLengthUnit(this.peek())) {
        if (left.unit) throw new FormulaError(`Cannot apply ${this.peek()} to ${left.unit}`);
        left = { value: toMillimeters(left.value, this.take() as 'mm' | 'cm' | 'm' | 'in'), unit: 'mm', bare: false };
        continue;
      }
      const op = this.take();
      const right = this.factor();
      if (op === '*') {
        if (left.unit && right.unit) throw new FormulaError(`Cannot multiply ${left.unit} by ${right.unit}`);
        left = { value: left.value * right.value, unit: left.unit ?? right.unit, bare: left.bare && right.bare };
      } else {
        if (right.value === 0) throw new FormulaError('Division by zero');
        if (!left.unit && right.unit) throw new FormulaError(`Cannot divide a unitless value by ${right.unit}`);
        if (left.unit && right.unit && left.unit !== right.unit) throw new FormulaError(`Cannot divide ${left.unit} by ${right.unit}`);
        left = { value: left.value / right.value, unit: left.unit && right.unit ? null : left.unit, bare: left.bare && right.bare };
      }
    }
    return left;
  }

  private factor(): Quantity {
    if (this.peek() === '+' || this.peek() === '-') {
      const sign = this.take();
      const value = this.factor();
      return { ...value, value: sign === '-' ? -value.value : value.value };
    }
    if (this.peek() === '(') {
      this.take();
      const value = this.expression();
      if (this.take() !== ')') throw new FormulaError('Missing closing parenthesis');
      return value;
    }
    const token = this.take();
    if (token === undefined) throw new FormulaError('Expected a value');
    if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
      return { value: Number(token), unit: null, bare: true };
    }
    if (NAME.test(token)) return this.lookup(token);
    throw new FormulaError(`Unexpected token “${token}”`);
  }
}

function compatibleAddUnit(left: Quantity, right: Quantity): ParameterUnit | null {
  if (left.unit === right.unit) return left.unit;
  if (left.bare && !left.unit) return right.unit;
  if (right.bare && !right.unit) return left.unit;
  throw new FormulaError(`Cannot combine ${left.unit ?? 'unitless'} and ${right.unit ?? 'unitless'}`);
}

function tokenize(expression: string): string[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) throw new FormulaError(`Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  const tokens: string[] = [];
  let offset = 0;
  const token = /\s*((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/])/y;
  while (offset < expression.length) {
    token.lastIndex = offset;
    const match = token.exec(expression);
    if (!match) throw new FormulaError(`Unexpected text near “${expression.slice(offset, offset + 12)}”`);
    tokens.push(match[1]);
    offset = token.lastIndex;
  }
  return tokens;
}

function isLengthUnit(token: string | undefined): token is 'mm' | 'cm' | 'm' | 'in' {
  return token === 'mm' || token === 'cm' || token === 'm' || token === 'in';
}

function parse(expression: string, lookup: Lookup): Quantity {
  return new Parser(tokenize(expression.trim()), lookup).parse();
}

/** Resolve a standalone length expression to canonical millimeters. */
export function evaluateLengthExpression(expression: string): number {
  const quantity = parse(expression, (name) => { throw new FormulaError(`Unknown parameter “${name}”`); });
  if (quantity.unit && quantity.unit !== 'mm') throw new FormulaError(`Expected a length, got ${quantity.unit}`);
  return quantity.value;
}

export interface ResolvedParameter extends NamedParameter { value: number }

export function resolveNamedParameters(definitions: NamedParameter[]): ResolvedParameter[] {
  const byName = new Map<string, NamedParameter>();
  for (const definition of definitions) {
    if (!NAME.test(definition.name)) throw new FormulaError(`Invalid parameter name “${definition.name}”`);
    if (byName.has(definition.name)) throw new FormulaError(`Duplicate parameter “${definition.name}”`);
    if (!['mm', 'deg', 'unitless'].includes(definition.unit)) throw new FormulaError(`Invalid unit for “${definition.name}”`);
    byName.set(definition.name, definition);
  }
  const resolved = new Map<string, ResolvedParameter>();
  const visiting: string[] = [];
  const get = (name: string): Quantity => {
    const cached = resolved.get(name);
    if (cached) return { value: cached.value, unit: cached.unit === 'unitless' ? null : cached.unit, bare: false };
    const definition = byName.get(name);
    if (!definition) throw new FormulaError(`Unknown parameter “${name}”`);
    const cycleAt = visiting.indexOf(name);
    if (cycleAt >= 0) throw new FormulaError(`Parameter cycle: ${[...visiting.slice(cycleAt), name].join(' → ')}`);
    visiting.push(name);
    const quantity = parse(definition.expression, get);
    visiting.pop();
    const unit = quantity.unit ?? (quantity.bare ? definition.unit : 'unitless');
    if (unit !== definition.unit) throw new FormulaError(`Parameter “${name}” expects ${definition.unit}, got ${unit}`);
    const result = { ...definition, value: quantity.value };
    resolved.set(name, result);
    return { value: result.value, unit: result.unit === 'unitless' ? null : result.unit, bare: false };
  };
  for (const definition of definitions) get(definition.name);
  return definitions.map((definition) => resolved.get(definition.name)!);
}

export function parameterUnitFor(kind: string, key: string): ParameterUnit {
  if (kind === 'rotate') return 'deg';
  if (kind === 'scale' || kind === 'mirror' || key.startsWith('axis') || key === 'axis' || key === 'flip' || key === 'count' || key === 'resolution') return 'unitless';
  return 'mm';
}

export function resolveTreeFormulas(tree: SDFNodeUI | null, definitions: NamedParameter[]): SDFNodeUI | null {
  const resolved = resolveNamedParameters(definitions);
  const values = new Map(resolved.map((item) => [item.name, item]));
  const visit = (node: SDFNodeUI): SDFNodeUI => {
    const children = node.children.map(visit);
    const childrenChanged = children.some((child, index) => child !== node.children[index]);
    if (!node.expressions || Object.keys(node.expressions).length === 0) {
      return childrenChanged ? { ...node, children } : node;
    }
    const patch: Record<string, number> = {};
    for (const [key, expression] of Object.entries(node.expressions ?? {})) {
      if (!(key in node.params) || !(key in (PARAMETER_SCHEMAS[node.kind] ?? {}))) throw new FormulaError(`${node.label}.${key} is not formula-driven`);
      const expected = parameterUnitFor(node.kind, key);
      const quantity = parse(expression, (name) => {
        const parameter = values.get(name);
        if (!parameter) throw new FormulaError(`Unknown parameter “${name}” in ${node.label}.${key}`);
        return { value: parameter.value, unit: parameter.unit, bare: false };
      });
      const unit = quantity.unit ?? (quantity.bare ? expected : 'unitless');
      if (unit !== expected) throw new FormulaError(`${node.label}.${key} expects ${expected}, got ${unit}`);
      patch[key] = quantity.value;
    }
    const result = applyNodeParamPatch(node, patch);
    if (!result.params) throw new FormulaError(result.error!);
    for (const [key, value] of Object.entries(patch)) {
      if (result.params[key] !== value) throw new FormulaError(`${node.label}.${key} result ${value} is outside its valid domain`);
    }
    const params = result.params;
    const paramsChanged = Object.keys(params).some((key) => params[key] !== node.params[key]);
    return paramsChanged || childrenChanged ? { ...node, params, children } : node;
  };
  return tree ? visit(tree) : null;
}
