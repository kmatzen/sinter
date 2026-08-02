import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    /**
     * Vitest's 5 s default is a poor fit here. A good part of this suite is
     * geometry that does real numeric work — marching a 40^3 grid, baking a
     * mesh field, running a full simplification — and those tests measured 3–9 s
     * apiece when the runner has all files in flight at once on 8 cores. They
     * then fail on machine load rather than on the code, which is how a suite
     * stops being believed.
     *
     * Nothing in the suite asserts elapsed time, so this is not a constraint
     * anything is testing; it is only a hang detector, and 60 s still catches a
     * hang long before CI's own limit. A test that needs more than this should
     * be given less work to do, not a longer clock.
     */
    testTimeout: 60_000,
  },
});
