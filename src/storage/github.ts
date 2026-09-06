import type { StorageProvider, ProjectMeta } from './types';
import { decodeProjectFileBody, MAX_PROJECT_JSON_CHARS } from '../types/documentDecoder';

const API = 'https://api.github.com';
const DESC_PREFIX = 'sinter:';
const FILE_PREFIX = 'sinter-';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function isOurs(gist: { description?: string | null; files?: Record<string, unknown> }): boolean {
  const d = gist.description || '';
  if (d.startsWith(DESC_PREFIX)) return true;
  // Legacy: pre-migration gists may not have a sinter-prefixed description.
  // Detect by file naming.
  const names = gist.files ? Object.keys(gist.files) : [];
  return names.some((n) => n.startsWith(FILE_PREFIX));
}

function nameFromGist(gist: { description?: string | null; files?: Record<string, unknown> }): string {
  const d = gist.description || '';
  if (d.startsWith(DESC_PREFIX)) return d.slice(DESC_PREFIX.length).trim() || 'Untitled';
  const names = gist.files ? Object.keys(gist.files) : [];
  const f = names.find((n) => n.startsWith(FILE_PREFIX));
  if (f) return f.replace(FILE_PREFIX, '').replace(/\.json$/, '');
  return 'Untitled';
}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

function selectProjectFile(files: Record<string, GistFile> | undefined): { filename: string; file: GistFile } {
  const matches = Object.entries(files ?? {}).filter(([name]) => name.startsWith(FILE_PREFIX));
  if (matches.length === 0) throw new Error('Gist does not contain a Sinter project file');
  if (matches.length > 1) throw new Error('Gist contains multiple Sinter project files; remove the duplicate before continuing');
  const [filename, file] = matches[0];
  return { filename, file };
}

async function getGistProject(token: string | null, externalId: string): Promise<{ filename: string; file: GistFile }> {
  const headers = token
    ? authHeaders(token)
    : { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const res = await fetch(`${API}/gists/${externalId}`, { headers });
  if (!res.ok) throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return selectProjectFile(data.files);
}

export const githubStorage: StorageProvider = {
  async list(token, signal) {
    const projects: ProjectMeta[] = [];
    let page = 1;
    // Paginate (max 100 per page). Stop when an empty page comes back.
    for (;;) {
      const res = await fetch(`${API}/gists?per_page=100&page=${page}`, { headers: authHeaders(token), signal });
      if (!res.ok) throw new Error(`GitHub list failed (${res.status})`);
      const gists = (await res.json()) as Array<{
        id: string;
        description: string | null;
        files: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>;
      if (gists.length === 0) break;
      for (const g of gists) {
        if (!isOurs(g)) continue;
        projects.push({
          externalId: g.id,
          name: nameFromGist(g),
          createdAt: g.created_at,
          updatedAt: g.updated_at,
        });
      }
      if (gists.length < 100) break;
      page++;
    }
    return projects;
  },

  async read(token, externalId) {
    const { file } = await getGistProject(token, externalId);
    let content = file.content || '';
    if (file.truncated && file.raw_url) {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const rawRes = await fetch(file.raw_url, { headers });
      if (!rawRes.ok) throw new Error('Failed to fetch raw gist content');
      content = await rawRes.text();
    }
    if (content.length > MAX_PROJECT_JSON_CHARS) throw new Error('GitHub project exceeds the supported document size');
    return decodeProjectFileBody(JSON.parse(content));
  },

  async create(token, name, body) {
    const filename = `${FILE_PREFIX}${crypto.randomUUID()}.json`;
    const res = await fetch(`${API}/gists`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        description: `${DESC_PREFIX}${name}`,
        public: false,
        files: { [filename]: { content: JSON.stringify(body) } },
      }),
    });
    if (!res.ok) throw new Error(`GitHub create failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return { externalId: data.id };
  },

  async update(token, externalId, body) {
    const { filename } = await getGistProject(token, externalId);
    const res = await fetch(`${API}/gists/${externalId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(body) } } }),
    });
    if (!res.ok) throw new Error(`GitHub update failed (${res.status}): ${await res.text()}`);
  },

  async rename(token, externalId, name) {
    const res = await fetch(`${API}/gists/${externalId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ description: `${DESC_PREFIX}${name}` }),
    });
    if (!res.ok) throw new Error(`GitHub rename failed (${res.status}): ${await res.text()}`);
  },

  async delete(token, externalId) {
    const res = await fetch(`${API}/gists/${externalId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub delete failed (${res.status}): ${await res.text()}`);
    }
  },

  // Secret gists are URL-accessible by anyone with the link, so "public" is
  // implicitly always true. Nothing to toggle.
  async setPublic(_token, _externalId, _isPublic) {},
  async isPublic(_token, _externalId) {
    return true;
  },
};
