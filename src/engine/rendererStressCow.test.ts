import { describe, expect, it } from 'vitest';
import { createRendererStressCow } from '../../e2e/fixtures/rendererStressCow';
import { toSDFNode } from '../worker/sdf/convert';
import { generateSDFFunction } from '../worker/sdf/codegen';
import { shaderCapacityError } from './SdfMesh';

describe('renderer stress cow regression corpus', () => {
  it('compiles deterministically and is rejected before it can exhaust the GPU', () => {
    const started = performance.now();
    const sdf = toSDFNode(createRendererStressCow());
    expect(sdf).not.toBeNull();
    const compiled = generateSDFFunction(sdf!);
    const legacyCompileMs = performance.now() - started;
    const selected = createRendererStressCow();
    const hotIds: string[] = [];
    let cursor = selected;
    while (cursor.children.length) { hotIds.push(cursor.id); cursor = cursor.children[0]; }
    hotIds.push(cursor.id);
    const hotCompiled = generateSDFFunction(toSDFNode(selected)!, { hotSourceIds: hotIds });

    // Keep code generation cheap enough for direct manipulation. Parameter
    // packing should make the capacity assertion below stop failing without
    // relaxing this time/source budget.
    expect(legacyCompileMs).toBeLessThan(250);
    expect(compiled.glsl.length).toBeLessThan(50_000);
    expect(compiled.paramCount).toBe(910);
    expect(hotCompiled.paramCount).toBeLessThan(100);
    expect(shaderCapacityError(compiled, {
      maxFragmentUniformComponents: 16_384,
      maxTextureImageUnits: 32,
    })).toBeNull();
  });
});
