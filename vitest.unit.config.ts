import { defineConfig } from 'vitest/config';

/**
 * Unit suite: in-process, per workspace, no HTTP server and no database file.
 * A unit test sits beside its source as <name>.test.ts; the scripts' own tests
 * (the exclusion-scan self-test and the dependency-report exit paths) run here too.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'examples/*/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    minWorkers: 1,
    maxWorkers: 2,
    reporters: ['default'],
  },
});
