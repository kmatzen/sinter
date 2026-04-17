import type { StorageProvider } from './types';
import db from '../db';

const DRIVE_API = 'https://www.googleapis.com';
const FOLDER_NAME = 'Sinter';

function headers(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Refresh an expired Google OAuth token. Returns the new access token. */
export async function refreshGoogleToken(userId: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const newToken = data.access_token;
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  db.prepare('UPDATE users SET oauth_access_token = ?, oauth_token_expires_at = ? WHERE id = ?')
    .run(newToken, expiresAt, userId);
  return newToken;
}

/** Find or create the Sinter folder in the user's Drive */
async function getOrCreateFolder(token: string): Promise<string> {
  // Search for existing folder
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`${DRIVE_API}/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: headers(token),
  });
  if (!searchRes.ok) throw new Error(`Drive search failed (${searchRes.status})`);
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  // Create folder
  const createRes = await fetch(`${DRIVE_API}/drive/v3/files`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) throw new Error(`Drive folder creation failed (${createRes.status})`);
  const folder = await createRes.json();
  return folder.id;
}

export const googleStorage: StorageProvider = {
  async create(token, filename, content, isPublic) {
    const folderId = await getOrCreateFolder(token);

    // Use multipart upload
    const metadata = {
      name: `${filename}.json`,
      mimeType: 'application/json',
      parents: [folderId],
    };
    const boundary = '---sinter-boundary';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
      `--${boundary}--`;

    const res = await fetch(`${DRIVE_API}/upload/drive/v3/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
    const data = await res.json();

    if (isPublic) {
      await this.setPublic(token, data.id, true);
    }

    return { externalId: data.id };
  },

  async read(token, externalId) {
    const h = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}?alt=media`, {
      headers: h,
    });
    if (!res.ok) throw new Error(`Drive read failed (${res.status}): ${await res.text()}`);
    return await res.text();
  },

  async update(token, externalId, content) {
    const res = await fetch(`${DRIVE_API}/upload/drive/v3/files/${externalId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: content,
    });
    if (!res.ok) throw new Error(`Drive update failed (${res.status}): ${await res.text()}`);
  },

  async delete(token, externalId) {
    const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Drive delete failed (${res.status}): ${await res.text()}`);
    }
  },

  async setPublic(token, externalId, isPublic) {
    if (isPublic) {
      // Grant "anyone with link" read access
      const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}/permissions`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      });
      if (!res.ok) throw new Error(`Drive permission failed (${res.status}): ${await res.text()}`);
    } else {
      // List permissions and remove "anyone" permission
      const listRes = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}/permissions?fields=permissions(id,type)`, {
        headers: headers(token),
      });
      if (!listRes.ok) return;
      const perms = await listRes.json();
      for (const perm of perms.permissions || []) {
        if (perm.type === 'anyone') {
          await fetch(`${DRIVE_API}/drive/v3/files/${externalId}/permissions/${perm.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
          });
        }
      }
    }
  },

  getPublicUrl(externalId) {
    return `https://drive.google.com/file/d/${externalId}/view`;
  },
};
