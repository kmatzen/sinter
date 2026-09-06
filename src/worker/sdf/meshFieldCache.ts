import type { MeshFieldData } from './types';

interface Entry {
  payload: string;
  resolution: number;
  field: MeshFieldData;
  bytes: number;
  lastUsed: number;
}

/** FNV-1a narrows the bucket; full payload equality establishes identity. */
export function meshPayloadHash(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + payload.length;
}

/** Collision-safe, byte-bounded LRU for expensive imported-mesh field bakes. */
export class MeshFieldCache {
  private readonly buckets = new Map<string, Entry[]>();
  private usedBytes = 0;
  private clock = 0;

  constructor(readonly maxBytes: number) {}

  getOrCreate(payload: string, resolution: number, create: () => MeshFieldData): MeshFieldData {
    const key = `${meshPayloadHash(payload)}@${resolution}`;
    const bucket = this.buckets.get(key);
    const hit = bucket?.find((entry) => entry.payload === payload && entry.resolution === resolution);
    if (hit) {
      hit.lastUsed = ++this.clock;
      return hit.field;
    }

    const field = create();
    // UTF-16 is the conservative in-memory cost for the retained base64 key.
    const bytes = field.data.byteLength + payload.length * 2;
    if (bytes > this.maxBytes) return field;

    const entry: Entry = { payload, resolution, field, bytes, lastUsed: ++this.clock };
    if (bucket) bucket.push(entry);
    else this.buckets.set(key, [entry]);
    this.usedBytes += bytes;
    this.evictToLimit();
    return field;
  }

  clear(): void {
    this.buckets.clear();
    this.usedBytes = 0;
  }

  stats(): { entries: number; bytes: number; maxBytes: number } {
    let entries = 0;
    for (const bucket of this.buckets.values()) entries += bucket.length;
    return { entries, bytes: this.usedBytes, maxBytes: this.maxBytes };
  }

  private evictToLimit(): void {
    while (this.usedBytes > this.maxBytes) {
      let oldestKey: string | undefined;
      let oldestIndex = -1;
      let oldest: Entry | undefined;
      for (const [key, bucket] of this.buckets) {
        for (let i = 0; i < bucket.length; i++) {
          if (!oldest || bucket[i].lastUsed < oldest.lastUsed) {
            oldest = bucket[i]; oldestKey = key; oldestIndex = i;
          }
        }
      }
      if (!oldest || oldestKey === undefined) break;
      const bucket = this.buckets.get(oldestKey)!;
      bucket.splice(oldestIndex, 1);
      if (bucket.length === 0) this.buckets.delete(oldestKey);
      this.usedBytes -= oldest.bytes;
    }
  }
}
