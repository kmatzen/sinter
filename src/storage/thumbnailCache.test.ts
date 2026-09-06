import { describe, expect, it } from 'vitest';
import { thumbnailCacheKey } from './thumbnailCache';

describe('thumbnail cache identity', () => {
  it('cannot collide across provider, account, or remote project identity', () => {
    const base = thumbnailCacheKey('google', 'account-a', 'same-id');
    expect(thumbnailCacheKey('github', 'account-a', 'same-id')).not.toBe(base);
    expect(thumbnailCacheKey('google', 'account-b', 'same-id')).not.toBe(base);
    expect(thumbnailCacheKey('google', 'account-a', 'other-id')).not.toBe(base);
  });
});
