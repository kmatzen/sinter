import type { StorageProvider, ProjectMeta } from './types';

const DRIVE_API = 'https://www.googleapis.com';
const FOLDER_NAME = 'Sinter';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_MARKER_KEY = 'sinterFolder';
const FOLDER_MARKER_VALUE = 'projects-v1';
const MAX_FOLDER_CACHE_ENTRIES = 4;

// A provider token identifies the signed-in account for this in-memory cache.
// Keeping one global id allowed an account switch to reuse another account's
// folder until logout happened to clear it.
const cachedFolderIds = new Map<string, string>();

function cacheFolder(token: string, folderId: string): void {
  cachedFolderIds.delete(token);
  cachedFolderIds.set(token, folderId);
  while (cachedFolderIds.size > MAX_FOLDER_CACHE_ENTRIES) {
    const oldest = cachedFolderIds.keys().next().value;
    if (oldest === undefined) break;
    cachedFolderIds.delete(oldest);
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface DriveFolder {
  id: string;
  createdTime?: string;
}

function folderOrder(a: DriveFolder, b: DriveFolder): number {
  return (a.createdTime ?? '').localeCompare(b.createdTime ?? '') || a.id.localeCompare(b.id);
}

async function findFolders(token: string, query: string, signal?: AbortSignal): Promise<DriveFolder[]> {
  const q = encodeURIComponent(`${query} and mimeType='${FOLDER_MIME}' and trashed=false`);
  const folders: DriveFolder[] = [];
  let pageToken: string | undefined;
  do {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await fetch(
      `${DRIVE_API}/drive/v3/files?q=${q}&fields=nextPageToken,files(id,createdTime)&orderBy=createdTime&pageSize=100${tokenParam}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    if (!res.ok) throw new Error(`Drive folder search failed (${res.status})`);
    const data = await res.json();
    folders.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return folders.sort(folderOrder);
}

async function validateCachedFolder(token: string, folderId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`${DRIVE_API}/drive/v3/files/${folderId}?fields=id,trashed`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Drive folder validation failed (${res.status})`);
  const folder = await res.json();
  return folder.id === folderId && folder.trashed !== true;
}

async function markFolder(token: string, folderId: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${DRIVE_API}/drive/v3/files/${folderId}`, {
    method: 'PATCH', headers: authHeaders(token), signal,
    body: JSON.stringify({ appProperties: { [FOLDER_MARKER_KEY]: FOLDER_MARKER_VALUE } }),
  });
  if (!res.ok) throw new Error(`Drive folder adoption failed (${res.status})`);
}

async function getOrCreateFolder(token: string, signal?: AbortSignal): Promise<string> {
  const cached = cachedFolderIds.get(token);
  if (cached) {
    if (await validateCachedFolder(token, cached, signal)) return cached;
    cachedFolderIds.delete(token);
  }

  const marked = await findFolders(
    token,
    `appProperties has { key='${FOLDER_MARKER_KEY}' and value='${FOLDER_MARKER_VALUE}' }`,
    signal,
  );
  if (marked.length > 0) {
    cacheFolder(token, marked[0].id);
    return marked[0].id;
  }

  // Adopt one legacy name-only folder deterministically. This prevents a
  // second app folder being created for existing users and makes future lookup
  // independent of its display name.
  const legacy = await findFolders(token, `name='${FOLDER_NAME}'`, signal);
  if (legacy.length > 0) {
    await markFolder(token, legacy[0].id, signal);
    cacheFolder(token, legacy[0].id);
    return legacy[0].id;
  }

  const createRes = await fetch(`${DRIVE_API}/drive/v3/files?fields=id,createdTime`, {
    method: 'POST',
    headers: authHeaders(token),
    signal,
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: FOLDER_MIME,
      appProperties: { [FOLDER_MARKER_KEY]: FOLDER_MARKER_VALUE },
    }),
  });
  if (!createRes.ok) throw new Error(`Drive folder creation failed (${createRes.status})`);
  const created = await createRes.json() as DriveFolder;

  // Concurrent tabs can both observe no folder and create one. Re-query and
  // converge on the oldest marked folder; include the response as a fallback
  // for Drive's eventually-consistent search index.
  const afterCreate = await findFolders(
    token,
    `appProperties has { key='${FOLDER_MARKER_KEY}' and value='${FOLDER_MARKER_VALUE}' }`,
    signal,
  );
  const canonical = [...afterCreate, created].sort(folderOrder)[0];
  cacheFolder(token, canonical.id);
  return canonical.id;
}

function stripJsonExt(name: string): string {
  return name.endsWith('.json') ? name.slice(0, -5) : name;
}

export const googleStorage: StorageProvider = {
  async list(token, signal) {
    const folderId = await getOrCreateFolder(token, signal);
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const files: Array<{ id: string; name: string; createdTime: string; modifiedTime: string }> = [];
    let pageToken: string | undefined;
    do {
      const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const res = await fetch(
        `${DRIVE_API}/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,createdTime,modifiedTime)&orderBy=modifiedTime desc&pageSize=200${tokenParam}`,
        { headers: { Authorization: `Bearer ${token}` }, signal },
      );
      if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
      const data = await res.json();
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return files.map(
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
      if (!listRes.ok) throw new Error(`Drive permission listing failed (${listRes.status})`);
      const perms = await listRes.json();
      for (const perm of perms.permissions || []) {
        if (perm.type === 'anyone') {
          const deleteRes = await fetch(
            `${DRIVE_API}/drive/v3/files/${externalId}/permissions/${perm.id}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
          );
          if (!deleteRes.ok && deleteRes.status !== 404) {
            throw new Error(`Drive permission removal failed (${deleteRes.status})`);
          }
        }
      }
      const verifyRes = await fetch(
        `${DRIVE_API}/drive/v3/files/${externalId}/permissions?fields=permissions(type)`,
        { headers: authHeaders(token) },
      );
      if (!verifyRes.ok) throw new Error(`Drive permission verification failed (${verifyRes.status})`);
      const remaining = await verifyRes.json();
      if ((remaining.permissions ?? []).some((permission: { type: string }) => permission.type === 'anyone')) {
        throw new Error('Drive share link is still public after revocation');
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
  cachedFolderIds.clear();
}
