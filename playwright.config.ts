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
    // CI uses the pinned Playwright bundle. Developers can point at an
    // already-installed Chromium build when downloading browsers is not
    // possible (for example, on a managed or offline workstation).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
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
      use: { browserName: 'chromium' },
      testIgnore: [/viewport-golden\.spec\.ts/, /mobile\.spec\.ts/],
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
      use: { browserName: 'chromium' },
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
