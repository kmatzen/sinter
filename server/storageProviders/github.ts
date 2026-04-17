import type { StorageProvider } from './types';

const API = 'https://api.github.com';

function headers(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export const githubStorage: StorageProvider = {
  async create(token, filename, content, _isPublic) {
    // GitHub gists: "public: false" creates a secret gist (unlisted but accessible via URL)
    const gistFilename = `sinter-${filename}.json`;
    const res = await fetch(`${API}/gists`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        description: `sinter:${filename}`,
        public: false,
        files: { [gistFilename]: { content } },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub API error (${res.status}): ${err}`);
    }
    const data = await res.json();
    return { externalId: data.id };
  },

  async read(token, externalId) {
    // Try authenticated first, fall back to unauthenticated for shared access
    const h = token ? headers(token) : { 'Accept': 'application/vnd.github+json' };
    const res = await fetch(`${API}/gists/${externalId}`, { headers: h });
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const files = data.files ? Object.values(data.files) : [];
    const file = files[0] as any;
    if (!file) throw new Error('Project file not found in gist');
    // If the file is truncated, fetch the raw URL
    if (file.truncated && file.raw_url) {
      const rawRes = await fetch(file.raw_url, { headers: h });
      if (!rawRes.ok) throw new Error('Failed to fetch raw gist content');
      return await rawRes.text();
    }
    return file.content;
  },

  async update(token, externalId, content) {
    // First fetch to get the actual filename in this gist
    const getRes = await fetch(`${API}/gists/${externalId}`, { headers: headers(token) });
    if (!getRes.ok) throw new Error(`GitHub API error (${getRes.status}): ${await getRes.text()}`);
    const gist = await getRes.json();
    const filename = Object.keys(gist.files || {})[0];
    if (!filename) throw new Error('No file in gist');

    const res = await fetch(`${API}/gists/${externalId}`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
    }
  },

  async delete(token, externalId) {
    const res = await fetch(`${API}/gists/${externalId}`, {
      method: 'DELETE',
      headers: headers(token),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
    }
  },

  async setPublic(_token, _externalId, _isPublic) {
    // GitHub doesn't support changing gist visibility after creation.
    // Secret gists are already accessible to anyone with the URL, which is
    // sufficient for our share-token system.
  },

  getPublicUrl(externalId) {
    return `https://gist.github.com/${externalId}`;
  },
};
