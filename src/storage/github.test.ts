import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubStorage } from './github';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const project = {
  version: 1 as const, thumbnail: null,
  tree: { id: 'box', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true },
};

describe('GitHub gist storage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reads the sole Sinter file regardless of object order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ files: {
      'notes.txt': { content: 'do not parse me' },
      'sinter-project.json': { content: JSON.stringify(project) },
    } })));

    await expect(githubStorage.read('token', 'gist')).resolves.toEqual({
      ...project, version: 2, checkpoints: [], parameters: [], views: [], measurements: [], components: [], revision: '',
      units: { displayUnit: 'mm', decimalPrecision: 2, fractionalDenominator: 16 },
    });
  });

  it('updates only the Sinter file in a multi-file gist', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: {
        'notes.txt': { content: 'keep me' },
        'sinter-project.json': { content: JSON.stringify(project) },
      } }))
      .mockResolvedValueOnce(json({ id: 'gist' }));
    vi.stubGlobal('fetch', fetchMock);

    await githubStorage.update('token', 'gist', project, '');

    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(Object.keys(request.files)).toEqual(['sinter-project.json']);
    expect(request.files['notes.txt']).toBeUndefined();
  });

  it('rejects an update when the gist revision changed remotely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ files: {
      'sinter-project.json': { content: JSON.stringify(project) },
    } }), { headers: { 'Content-Type': 'application/json', ETag: 'new-revision' } })));

    await expect(githubStorage.update('token', 'gist', project, 'old-revision')).rejects.toThrow(/changed elsewhere/);
  });

  it('fails closed when no Sinter file exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ files: {
      'notes.txt': { content: '{}' },
    } })));

    await expect(githubStorage.read('token', 'gist')).rejects.toThrow('does not contain');
  });

  it('fails closed when the gist has ambiguous Sinter files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ files: {
      'sinter-one.json': { content: JSON.stringify(project) },
      'sinter-two.json': { content: JSON.stringify(project) },
    } })));

    await expect(githubStorage.update('token', 'gist', project, '')).rejects.toThrow('multiple');
  });

  it('fetches truncated content from the selected Sinter file', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ files: {
        'notes.txt': { content: 'wrong' },
        'sinter-project.json': { truncated: true, raw_url: 'https://gist.example/raw' },
      } }))
      .mockResolvedValueOnce(json(project));
    vi.stubGlobal('fetch', fetchMock);

    await expect(githubStorage.read('token', 'gist')).resolves.toEqual({
      ...project, version: 2, checkpoints: [], parameters: [], views: [], measurements: [], components: [], revision: '',
      units: { displayUnit: 'mm', decimalPrecision: 2, fractionalDenominator: 16 },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://gist.example/raw');
  });
});
