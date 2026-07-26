import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // CI runs this suite on a two-core runner rendering through SwiftShader, where
  // the whole thing takes ~8.5 min. At 30s per test a single `page.goto` in
  // sdf-parity was already timing out under that load — a flaky failure about
  // machine contention rather than the code under test. 60s leaves room for a
  // slow app boot while still catching a genuine hang.
  timeout: 60000,
  // Suite ceiling, raised in step with the per-test budget and the move to a
  // single CI worker below: ~9 min of work under a 10 min cap left no margin.
  globalTimeout: 1200000, // 20 min max for entire suite
  // One worker on CI. Every spec here drives a WebGL context that CI renders in
  // software, so two workers on a two-core runner oversubscribe it: whichever
  // test is marching pixels starves the other, and the symptom lands on the
  // victim rather than the cause — `sdf-parity`'s `page.goto` was timing out at
  // 60s while the marcher spec rendered. Serial costs little wall-clock here,
  // because `app.spec.ts` alone is ~9 of the ~10 minutes.
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    actionTimeout: 15000,
  },
  webServer: {
    command: 'npx vite --port 5174',
    port: 5174,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
