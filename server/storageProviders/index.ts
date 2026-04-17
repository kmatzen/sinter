import type { StorageProvider } from './types';
import { githubStorage } from './github';
import { googleStorage } from './google';
import { refreshGoogleToken } from './google';
import db from '../db';

export type { StorageProvider };

export function getStorageProvider(provider: string): StorageProvider {
  switch (provider) {
    case 'github': return githubStorage;
    case 'google': return googleStorage;
    default: throw new Error(`Unknown storage provider: ${provider}`);
  }
}

interface UserTokens {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
}

/**
 * Get a valid access token for a user's storage provider.
 * Automatically refreshes Google tokens if expired.
 */
export async function getUserToken(userId: string): Promise<UserTokens> {
  const user = db.prepare(
    'SELECT provider, oauth_access_token, oauth_refresh_token, oauth_token_expires_at FROM users WHERE id = ?'
  ).get(userId) as any;

  if (!user || !user.oauth_access_token) {
    throw new Error('No storage credentials. Please re-authenticate.');
  }

  let accessToken = user.oauth_access_token;

  // Refresh Google token if expired or expiring within 5 minutes
  if (user.provider === 'google' && user.oauth_token_expires_at) {
    const expiresAt = new Date(user.oauth_token_expires_at);
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (expiresAt < fiveMinFromNow && user.oauth_refresh_token) {
      accessToken = await refreshGoogleToken(userId, user.oauth_refresh_token);
    }
  }

  return {
    provider: user.provider,
    accessToken,
    refreshToken: user.oauth_refresh_token,
  };
}
