import { defineConfig } from '@playwright/test';

const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : undefined;

export default defineConfig({
  testDir: './e2e',
  // CI runs this suite on a two-core runner rendering through SwiftShader, where
  // the whole thing takes ~8.5 min. At 30s per test a single `page.goto` in
  // sdf-parity was already timing out under that load — a flaky failure about
  // machine contention rather than the code under test. 60s leaves room for a
  // slow app boot while still catching a genuine hang.
  timeout: 60000,
  // Suite ceiling also applies when reproducing an individual CI shard.
  globalTimeout: 1200000, // 20 min max for entire suite
  // Each CI runner still uses one worker because WebGL is rendered in software.
  // `fullyParallel` lets Playwright distribute individual tests—not only whole
  // spec files—across the isolated runners selected with `--shard`. This is
  // essential because app.spec.ts otherwise dominates one shard by itself.
  fullyParallel: !!process.env.CI,
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
    {
      name: 'chromium',
      use: { browserName: 'chromium', launchOptions: localChromium },
      testIgnore: [/viewport-golden\.spec\.ts/, /mobile\.spec\.ts/, /cross-browser\.spec\.ts/],
    },
    {
      /*
       * Mobile. Nothing else in the suite runs at a phone viewport with touch
       * enabled, so every mobile regression — undersized targets, a blank first
       * run, inputs that zoom iOS on focus — passed CI silently. The device
       * descriptor is applied per-spec via `test.use`, which keeps the emulated
       * device next to the assertions that depend on it.
       */
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { browserName: 'chromium', launchOptions: localChromium },
    },
    {
      name: 'firefox-smoke',
      testMatch: /cross-browser\.spec\.ts/,
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit-smoke',
      testMatch: /cross-browser\.spec\.ts/,
      use: { browserName: 'webkit' },
    },
    {
      // Golden images run against SwiftShader everywhere, not against whatever
      // GPU the machine has. #52 rejected golden images as brittle across GPUs
      // and driver versions, and that objection is right — so this project
      // removes the variable rather than tolerating it. SwiftShader ships
      // inside the pinned Playwright browser build, so a developer's machine
      // and the CI runner execute the same rasteriser, and the reference images
      // are portable. Only CPU-architecture arithmetic differences remain,
      // which the per-pixel threshold in the spec absorbs.
      name: 'golden',
      testMatch: /viewport-golden\.spec\.ts/,
      // Reference images are not platform-scoped, because pinning SwiftShader
      // is what makes them portable. Playwright's default template appends the
      // OS name, which would leave CI with no image to compare against and each
      // developer maintaining their own set.
      snapshotPathTemplate: '{testDir}/golden-snapshots/{arg}{ext}',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            // Chromium refuses to fall back to SwiftShader without this once a
            // real GPU is available, which is exactly the case on a developer
            // machine.
            '--enable-unsafe-swiftshader',
            '--disable-gpu',
          ],
        },
      },
    },
  ],
});
