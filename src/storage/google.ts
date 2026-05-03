import type { StorageProvider, ProjectMeta } from './types';

const DRIVE_API = 'https://www.googleapis.com';
const FOLDER_NAME = 'Sinter';

let cachedFolderId: string | null = null;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getOrCreateFolder(token: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const searchRes = await fetch(`${DRIVE_API}/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!searchRes.ok) throw new Error(`Drive search failed (${searchRes.status})`);
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) {
    cachedFolderId = searchData.files[0].id;
    return cachedFolderId!;
  }
  const createRes = await fetch(`${DRIVE_API}/drive/v3/files`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!createRes.ok) throw new Error(`Drive folder creation failed (${createRes.status})`);
  const folder = await createRes.json();
  cachedFolderId = folder.id;
  return cachedFolderId!;
}

function stripJsonExt(name: string): string {
  return name.endsWith('.json') ? name.slice(0, -5) : name;
}

export const googleStorage: StorageProvider = {
  async list(token) {
    const folderId = await getOrCreateFolder(token);
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await fetch(
      `${DRIVE_API}/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime)&orderBy=modifiedTime desc&pageSize=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
    const data = await res.json();
    return (data.files || []).map(
      (f: { id: string; name: string; createdTime: string; modifiedTime: string }): ProjectMeta => ({
        externalId: f.id,
        name: stripJsonExt(f.name),
        createdAt: f.createdTime,
        updatedAt: f.modifiedTime,
      }),
    );
  },

  async read(token, externalId) {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}?alt=media`, { headers });
    if (!res.ok) throw new Error(`Drive read failed (${res.status})`);
    const text = await res.text();
    return JSON.parse(text);
  },

  async create(token, name, body) {
    const folderId = await getOrCreateFolder(token);
    const metadata = {
      name: `${name}.json`,
      mimeType: 'application/json',
      parents: [folderId],
    };
    const boundary = '---sinter-boundary';
    const reqBody =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n` +
      `--${boundary}--`;
    const res = await fetch(`${DRIVE_API}/upload/drive/v3/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: reqBody,
    });
    if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return { externalId: data.id };
  },

  async update(token, externalId, body) {
    const res = await fetch(
      `${DRIVE_API}/upload/drive/v3/files/${externalId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`Drive update failed (${res.status}): ${await res.text()}`);
  },

  async rename(token, externalId, name) {
    const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ name: `${name}.json` }),
    });
    if (!res.ok) throw new Error(`Drive rename failed (${res.status}): ${await res.text()}`);
  },

  async delete(token, externalId) {
    const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Drive delete failed (${res.status}): ${await res.text()}`);
    }
  },

  async setPublic(token, externalId, isPublic) {
    if (isPublic) {
      const res = await fetch(`${DRIVE_API}/drive/v3/files/${externalId}/permissions`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      });
      if (!res.ok) throw new Error(`Drive permission failed (${res.status})`);
    } else {
      const listRes = await fetch(
        `${DRIVE_API}/drive/v3/files/${externalId}/permissions?fields=permissions(id,type)`,
        { headers: authHeaders(token) },
      );
      if (!listRes.ok) return;
      const perms = await listRes.json();
      for (const perm of perms.permissions || []) {
        if (perm.type === 'anyone') {
          await fetch(
            `${DRIVE_API}/drive/v3/files/${externalId}/permissions/${perm.id}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
          );
        }
      }
    }
  },

  async isPublic(token, externalId) {
    const res = await fetch(
      `${DRIVE_API}/drive/v3/files/${externalId}/permissions?fields=permissions(type)`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return false;
    const data = await res.json();
    return (data.permissions || []).some((p: { type: string }) => p.type === 'anyone');
  },
};

export function clearGoogleCache() {
  cachedFolderId = null;
}
