import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGoogleCache, googleStorage } from './google';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Google Drive storage', () => {
  beforeEach(() => {
    clearGoogleCache();
    vi.restoreAllMocks();
  });

  it('follows every project page and forwards cancellation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'folder', createdTime: '2020-01-01' }] }))
      .mockResolvedValueOnce(json({
        files: [{ id: 'new', name: 'New.json', createdTime: '2024-01-01', modifiedTime: '2025-01-01', appProperties: { sinterProject: 'document-v1' } }],
        nextPageToken: 'page two',
      }))
      .mockResolvedValueOnce(json({
        files: [{ id: 'old', name: 'Old.json', createdTime: '2023-01-01', modifiedTime: '2024-01-01', appProperties: { sinterProject: 'document-v1' } }],
      }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const projects = await googleStorage.list('token', controller.signal);

    expect(projects.map((project) => project.externalId)).toEqual(['new', 'old']);
    expect(String(fetchMock.mock.calls[2][0])).toContain('pageToken=page%20two');
    for (const call of fetchMock.mock.calls) expect(call[1]?.signal).toBe(controller.signal);
  });

  it('hides unrelated folder contents and adopts only valid legacy projects', async () => {
    const body = {
      version: 1, thumbnail: null,
      tree: { id: 'box', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'folder', createdTime: '2020-01-01' }] }))
      .mockResolvedValueOnce(json({ files: [
        { id: 'marked', name: 'Marked.json', createdTime: '', modifiedTime: '', mimeType: 'application/json', appProperties: { sinterProject: 'document-v1' } },
        { id: 'legacy', name: 'Legacy.json', createdTime: '', modifiedTime: '', mimeType: 'application/json' },
        { id: 'unrelated-json', name: 'Notes.json', createdTime: '', modifiedTime: '', mimeType: 'application/json' },
        { id: 'image', name: 'Photo.png', createdTime: '', modifiedTime: '', mimeType: 'image/png' },
      ] }))
      .mockResolvedValueOnce(json(body))
      .mockResolvedValueOnce(json({ id: 'legacy' }))
      .mockResolvedValueOnce(json({ hello: 'world' }));
    vi.stubGlobal('fetch', fetchMock);

    const projects = await googleStorage.list('token');

    expect(projects.map((project) => project.externalId)).toEqual(['marked', 'legacy']);
    expect(String(fetchMock.mock.calls[2][0])).toContain('/legacy?alt=media');
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      appProperties: { sinterProject: 'document-v1' },
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/image?alt=media'))).toBe(false);
  });

  it('marks newly created files as Sinter projects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'folder', createdTime: '2020-01-01' }] }))
      .mockResolvedValueOnce(json({ id: 'project' }));
    vi.stubGlobal('fetch', fetchMock);

    await googleStorage.create('token', 'Project', { version: 1, thumbnail: null, tree: null });

    const multipart = String(fetchMock.mock.calls[1][1]?.body);
    expect(multipart).toContain('"appProperties":{"sinterProject":"document-v1"}');
  });

  it('refuses destructive actions for unverified files', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ id: 'notes', appProperties: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(googleStorage.delete('token', 'notes')).rejects.toThrow('not a verified');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adopts the oldest legacy folder and marks it as app-owned', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ files: [
        { id: 'newer', createdTime: '2022-01-01' },
        { id: 'older', createdTime: '2020-01-01' },
      ] }))
      .mockResolvedValueOnce(json({ id: 'older' }))
      .mockResolvedValueOnce(json({ files: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await googleStorage.list('token');

    expect(String(fetchMock.mock.calls[2][0])).toContain('/drive/v3/files/older');
    expect(fetchMock.mock.calls[2][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      appProperties: { sinterFolder: 'projects-v1' },
    });
    expect(String(fetchMock.mock.calls[3][0])).toContain("'older'%20in%20parents");
  });

  it('drops a stale cached folder and recovers the marked replacement', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'first', createdTime: '2020-01-01' }] }))
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ files: [{ id: 'replacement', createdTime: '2021-01-01' }] }))
      .mockResolvedValueOnce(json({ files: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await googleStorage.list('token');
    await googleStorage.list('token');

    expect(String(fetchMock.mock.calls[2][0])).toContain('/drive/v3/files/first?');
    expect(String(fetchMock.mock.calls[4][0])).toContain("'replacement'%20in%20parents");
  });

  it('never reuses a folder across provider accounts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'folder-a', createdTime: '2020-01-01' }] }))
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ files: [{ id: 'folder-b', createdTime: '2020-01-01' }] }))
      .mockResolvedValueOnce(json({ files: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await googleStorage.list('token-a');
    await googleStorage.list('token-b');

    expect(String(fetchMock.mock.calls[1][0])).toContain("'folder-a'%20in%20parents");
    expect(String(fetchMock.mock.calls[3][0])).toContain("'folder-b'%20in%20parents");
  });

  it('converges on the oldest marker when another tab creates concurrently', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ id: 'ours', createdTime: '2024-01-02' }))
      .mockResolvedValueOnce(json({ files: [{ id: 'other-tab', createdTime: '2024-01-01' }] }))
      .mockResolvedValueOnce(json({ files: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await googleStorage.list('token');

    expect(String(fetchMock.mock.calls[2][0])).toContain('fields=id,createdTime');
    expect(String(fetchMock.mock.calls[4][0])).toContain("'other-tab'%20in%20parents");
  });

  it('does not report revocation until public permissions are gone', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ id: 'file', appProperties: { sinterProject: 'document-v1' } }))
      .mockResolvedValueOnce(json({ permissions: [{ id: 'public', type: 'anyone' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ permissions: [{ type: 'anyone' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(googleStorage.setPublic('token', 'file', false)).rejects.toThrow('still public');
  });

  it('rejects permission-list and permission-delete failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ id: 'file', appProperties: { sinterProject: 'document-v1' } }))
      .mockResolvedValueOnce(json({}, 503)));
    await expect(googleStorage.setPublic('token', 'file', false)).rejects.toThrow('listing failed');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ id: 'file', appProperties: { sinterProject: 'document-v1' } }))
      .mockResolvedValueOnce(json({ permissions: [{ id: 'public', type: 'anyone' }] }))
      .mockResolvedValueOnce(json({}, 403));
    vi.stubGlobal('fetch', fetchMock);
    await expect(googleStorage.setPublic('token', 'file', false)).rejects.toThrow('removal failed');
  });

  it('completes revocation only after verification sees no public permission', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ id: 'file', appProperties: { sinterProject: 'document-v1' } }))
      .mockResolvedValueOnce(json({ permissions: [{ id: 'public', type: 'anyone' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ permissions: [{ type: 'user' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(googleStorage.setPublic('token', 'file', false)).resolves.toBeUndefined();
  });
});
