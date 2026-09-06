import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const limits = new Map([
  ['public/hero-bg-768.webp', 25_000],
  ['public/hero-bg-1536.webp', 75_000],
  ['public/feature-ai.webp', 20_000],
  ['public/feature-preview.webp', 20_000],
  ['public/feature-printing.webp', 20_000],
  ['public/feature-workflow.webp', 20_000],
  ['public/feature-booleans.webp', 20_000],
  ['public/feature-library.webp', 20_000],
]);

const failures = [];
let featureBytes = 0;
for (const [relativePath, maximum] of limits) {
  const bytes = (await stat(path.join(root, relativePath))).size;
  if (relativePath.includes('feature-')) featureBytes += bytes;
  if (bytes > maximum) failures.push(`${relativePath}: ${bytes} bytes exceeds ${maximum}`);
}
if (featureBytes > 75_000) failures.push(`feature images: ${featureBytes} bytes exceeds 75000`);

const landing = await readFile(path.join(root, 'src/components/landing/LandingPage.tsx'), 'utf8');
if (!landing.includes('loading="lazy"')) failures.push('feature images must remain lazy-loaded');
if (!landing.includes('hero-bg-768.webp 768w')) failures.push('hero must retain a mobile responsive source');

if (failures.length) {
  console.error(`Landing performance budget failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Landing asset budget passed (mobile hero <= 25 KB; feature set ${featureBytes} bytes).`);
}
