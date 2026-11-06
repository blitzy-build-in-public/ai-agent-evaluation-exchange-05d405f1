import { defineConfig } from 'vitest/config';

/**
 * Integration suite: starts apps/api on an ephemeral port with one in-memory
 * SQLite connection, migrations applied at start-up and the seed loaded through
 * the exported seed function. No database file and no environment variable.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/api/test/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    minWorkers: 1,
    maxWorkers: 2,
    reporters: ['default'],
  },
});
