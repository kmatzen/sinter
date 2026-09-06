import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_HEADERS, verifyProduction } from './verify-production.mjs';

function response({ status = 200, headers = {}, body = '' } = {}) {
  return new Response(body, { status, headers });
}

test('retries stale production state until headers and identity converge together', async () => {
  let round = 0;
  const sleeps = [];
  const fetchImpl = async (url, options) => {
    const isHome = options?.method === 'HEAD';
    if (isHome) round += 1;
    if (round < 3) {
      return isHome
        ? response()
        : response({ body: JSON.stringify({ commit: 'old', release: 'old' }) });
    }
    return isHome
      ? response({ headers: Object.fromEntries(REQUIRED_HEADERS.map((name) => [name, 'present'])) })
      : response({ body: JSON.stringify({ commit: 'abc', release: 'v1.2.3' }) });
  };

  const build = await verifyProduction({
    baseUrl: 'https://example.test', expectedCommit: 'abc', expectedRelease: 'v1.2.3',
    attempts: 4, intervalMs: 7, fetchImpl, sleep: async (ms) => sleeps.push(ms),
  });

  assert.equal(build.commit, 'abc');
  assert.deepEqual(sleeps, [7, 7]);
});

test('reports the last observed state when production never converges', async () => {
  const fetchImpl = async (_url, options) => options?.method === 'HEAD'
    ? response({ headers: { 'content-security-policy': 'present' } })
    : response({ body: '<html>old fallback</html>' });

  await assert.rejects(
    verifyProduction({
      baseUrl: 'https://example.test', expectedCommit: 'abc', expectedRelease: 'v1.2.3',
      attempts: 2, intervalMs: 0, fetchImpl, sleep: async () => {},
    }),
    (error) => {
      assert.match(error.message, /missingHeaders/);
      assert.match(error.message, /invalidJson/);
      assert.match(error.message, /old fallback/);
      return true;
    },
  );
});
