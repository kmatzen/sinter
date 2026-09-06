import { pathToFileURL } from 'node:url';

export const REQUIRED_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'permissions-policy',
  'x-frame-options',
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function verifyProduction({
  baseUrl,
  expectedCommit,
  expectedRelease,
  attempts = 12,
  intervalMs = 5_000,
  fetchImpl = fetch,
  sleep = wait,
}) {
  let lastObserved = 'no response';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const nonce = `${Date.now()}-${attempt}`;
      const [home, buildResponse] = await Promise.all([
        fetchImpl(`${baseUrl}/?verify=${nonce}`, { method: 'HEAD', cache: 'no-store' }),
        fetchImpl(`${baseUrl}/build.json?verify=${nonce}`, { cache: 'no-store' }),
      ]);
      const missingHeaders = REQUIRED_HEADERS.filter((name) => !home.headers.get(name));
      const buildText = await buildResponse.text();
      let build;
      try { build = JSON.parse(buildText); } catch { build = { invalidJson: buildText.slice(0, 160) }; }

      lastObserved = JSON.stringify({
        homeStatus: home.status,
        buildStatus: buildResponse.status,
        missingHeaders,
        build,
      });
      if (
        home.ok
        && buildResponse.ok
        && missingHeaders.length === 0
        && build.commit === expectedCommit
        && build.release === expectedRelease
      ) {
        return build;
      }
    } catch (error) {
      lastObserved = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) await sleep(intervalMs);
  }

  throw new Error(
    `Production did not converge after ${attempts} attempts. Last observed: ${lastObserved}`,
  );
}

async function main() {
  const baseUrl = process.env.PRODUCTION_URL ?? 'https://sinter-3d.com';
  const expectedCommit = process.env.EXPECTED_SHA;
  const expectedRelease = process.env.EXPECTED_RELEASE;
  if (!expectedCommit || !expectedRelease) {
    throw new Error('EXPECTED_SHA and EXPECTED_RELEASE are required');
  }
  const build = await verifyProduction({ baseUrl, expectedCommit, expectedRelease });
  console.log(`Verified ${build.release} (${build.commit}) on ${baseUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
