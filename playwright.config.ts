import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // CI runs this suite on a two-core runner rendering through SwiftShader, where
  // the whole thing takes ~8.5 min. At 30s per test a single `page.goto` in
  // sdf-parity was already timing out under that load — a flaky failure about
  // machine contention rather than the code under test. 60s leaves room for a
  // slow app boot while still catching a genuine hang.
  timeout: 60000,
  // Suite ceiling, raised in step with the per-test budget: 8.5 min of work under
  // a 10 min cap left no margin for a slow runner.
  globalTimeout: 1200000, // 20 min max for entire suite
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
