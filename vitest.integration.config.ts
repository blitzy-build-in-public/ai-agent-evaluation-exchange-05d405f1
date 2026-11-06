import { defineConfig } from 'vitest/config';

/**
 * Integration suite: starts apps/api on an ephemeral port with one in-memory
 * SQLite connection, migrations applied at start-up and the seed loaded through
 * the exported seed function. No database file and no environment variable.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['apps/api/test/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Forks isolate each suite's own server, port and native better-sqlite3
    // connection, so a leak in one file cannot reach another file's in-memory
    // database. `fileParallelism: false` then runs the files one after another
    // (vitest pins the worker count to 1), so a server boot and eleven migrations
    // per file never contend for a port or for CPU.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: false,
    minWorkers: 1,
    maxWorkers: 2,
    reporters: ['default'],
  },
});
