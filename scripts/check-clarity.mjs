#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const port = Number(process.env.SINTER_CLARITY_PORT || 4175);
const baseUrl = process.env.SINTER_CLARITY_URL || `http://127.0.0.1:${port}`;
const modulePath = process.env.CLARITY_MODULE || '../../clarity/dist/index.js';
const initScript = await readFile(new URL('./clarity-init.js', import.meta.url), 'utf8');
const { analyze } = await import(pathToFileURL(new URL(modulePath, import.meta.url).pathname).href);

const gatingKeys = [
  'contrastFailures',
  'axeViolations',
  'cvdContrastRegressions',
  'typographyErrors',
  'textSpacingFailures',
];

const baseline = (contrastFailures, cvdContrastRegressions = 0, typographyErrors = 0, textSpacingFailures = 0) => ({
  contrastFailures,
  axeViolations: 0,
  cvdContrastRegressions,
  typographyErrors,
  textSpacingFailures,
});

// Existing findings are explicit debt, not a reason to postpone adoption.
// This gate fails on any increase; reductions ratchet forward by updating the
// reviewed values in this file. Advisory warning/glyph counts remain visible
// in the artifact without making the job noisy.
const targets = [
  { name: 'landing-desktop', path: '/', viewport: { width: 1280, height: 800 }, waitFor: 'h1', baseline: baseline(46) },
  { name: 'landing-mobile', path: '/', viewport: { width: 390, height: 844 }, waitFor: 'h1', baseline: baseline(45) },
  { name: 'login-desktop', path: '/app', viewport: { width: 1280, height: 800 }, waitFor: 'button', baseline: baseline(3) },
  { name: 'login-mobile', path: '/app', viewport: { width: 390, height: 844 }, waitFor: 'button', baseline: baseline(3) },
  { name: 'editor-desktop', path: '/app', viewport: { width: 1280, height: 800 }, initScript, waitFor: '[role="treeitem"][aria-label^="Bracket assembly"]', baseline: baseline(34) },
  { name: 'editor-mobile', path: '/app', viewport: { width: 390, height: 844 }, initScript, waitFor: '[data-testid="modeler-app"]', baseline: baseline(6) },
];

let preview;
async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Sinter preview did not become ready at ${baseUrl}`);
}

if (!process.env.SINTER_CLARITY_URL) {
  preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

try {
  await waitForServer();
  const reports = [];
  let failed = false;
  for (const target of targets) {
    const report = await analyze({
      source: `${baseUrl}${target.path}`,
      viewport: target.viewport,
      initScript: target.initScript,
      waitFor: target.waitFor,
    });
    reports.push({ name: target.name, ...report });
    console.log(`${target.name}: ${JSON.stringify(report.summary)}`);
    if (!target.baseline) continue;
    for (const key of gatingKeys) {
      if (report.summary[key] > target.baseline[key]) {
        console.error(`${target.name}: ${key} regressed from ${target.baseline[key]} to ${report.summary[key]}`);
        failed = true;
      }
    }
  }
  await writeFile('clarity-report.json', `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`);
  if (failed) process.exitCode = 1;
} finally {
  if (preview) preview.kill('SIGTERM');
}
