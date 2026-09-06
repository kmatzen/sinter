import type { ProviderName, StorageProvider } from './types';
import { googleStorage, clearGoogleCache } from './google';
import { githubStorage } from './github';

export { StorageConflictError } from './types';
export type { ProviderName, StorageProvider, ProjectMeta, ProjectFileBody, ProjectReadResult, ProjectCheckpoint } from './types';

export function getStorageProvider(name: ProviderName): StorageProvider {
  switch (name) {
    case 'google':
      return googleStorage;
    case 'github':
      return githubStorage;
  }
}

export function clearProviderCaches() {
  clearGoogleCache();
}

export function buildShareUrl(provider: ProviderName, externalId: string): string {
  return `${window.location.origin}/shared#provider=${provider}&id=${externalId}`;
}

export function parseShareHash(hash: string): { provider: ProviderName; id: string } | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const provider = params.get('provider');
  const id = params.get('id');
  if ((provider !== 'google' && provider !== 'github') || !id) return null;
  return { provider, id };
}
