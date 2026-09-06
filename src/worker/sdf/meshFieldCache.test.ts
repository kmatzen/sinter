import { describe, expect, it, vi } from 'vitest';
import type { MeshFieldData } from './types';
import { MeshFieldCache, meshPayloadHash } from './meshFieldCache';

const A = 'ZOKB5d0yoPmBpXFQIj7VW0j9FeBHAoEIiuoPHVM/HsHvnIaH';
const B = 'vVXIMQeRKXlQqVhC4j/+S8zDs+B5RtKoxdiJFVgZB9J0Fxov';

function field(value: number, bytes = 16): MeshFieldData {
  return { bbox: { min: [0, 0, 0], max: [1, 1, 1] }, res: 1, data: new Float32Array(bytes / 4).fill(value) };
}

describe('MeshFieldCache', () => {
  it('verifies full payload identity when hash buckets collide', () => {
    expect(meshPayloadHash(A)).toBe(meshPayloadHash(B));
    const cache = new MeshFieldCache(1024);
    const createA = vi.fn(() => field(1));
    const createB = vi.fn(() => field(2));
    const bakedA = cache.getOrCreate(A, 8, createA);
    const bakedB = cache.getOrCreate(B, 8, createB);
    expect(bakedB).not.toBe(bakedA);
    expect(cache.getOrCreate(A, 8, createA)).toBe(bakedA);
    expect(createA).toHaveBeenCalledOnce();
    expect(createB).toHaveBeenCalledOnce();
  });

  it('includes resolution in identity', () => {
    const cache = new MeshFieldCache(1024);
    expect(cache.getOrCreate(A, 8, () => field(1))).not.toBe(cache.getOrCreate(A, 16, () => field(2)));
  });

  it('evicts least-recently-used fields and stays within its byte limit', () => {
    const entryBytes = 16 + A.length * 2;
    const cache = new MeshFieldCache(entryBytes * 2);
    const a = cache.getOrCreate(A, 8, () => field(1));
    cache.getOrCreate(B, 8, () => field(2));
    cache.getOrCreate(A, 8, () => field(9)); // make A most recent
    cache.getOrCreate('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 8, () => field(3));
    expect(cache.stats()).toMatchObject({ entries: 2, bytes: entryBytes * 2 });
    expect(cache.getOrCreate(A, 8, () => field(9))).toBe(a);
    const rebakeB = vi.fn(() => field(4));
    cache.getOrCreate(B, 8, rebakeB);
    expect(rebakeB).toHaveBeenCalledOnce();
    expect(cache.stats().bytes).toBeLessThanOrEqual(cache.maxBytes);
  });
});
