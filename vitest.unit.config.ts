import { defineConfig } from 'vitest/config';

/**
 * Unit suite: in-process, per workspace, no HTTP server and no database file.
 *
 * A unit test sits beside its source as <name>.test.ts, in any workspace and for the
 * scripts' own tests, so a new test file is discovered by placing it there: this
 * configuration is the only place the unit suite's files are found.
 *
 * `pool: 'forks'` runs every test file in a forked process rather than a worker
 * thread. packages/sgi-core and packages/commerce-sim load the better-sqlite3 native
 * addon, so a process per file keeps that addon, its file handles and each test's own
 * in-memory database isolated and reproducible.
 *
 * The snapshot update mode is not settable from this file: Vitest 1.6 derives it during
 * config resolution from `update`, the UPDATE_SNAPSHOT variable and CI, overriding any
 * `snapshotOptions` block a config carries — which is a type error against InlineConfig
 * as well as inert. `update: false` records the intent in the only input a config file
 * has, and CI, which is where the test workflow runs `npm test`, resolves the mode to
 * `none`, so a missing, mismatched or obsolete baseline fails the run instead of being
 * rewritten. Regenerating a baseline stays an explicit act: `vitest run --update`.
 *
 * There is no coverage block: the dependency inventory holds no coverage package, and
 * coverage of the pure scoring, policy and ledger functions is a review guideline rather
 * than a gate that can run.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['{apps,packages,examples}/**/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The integration suite owns apps/api/test/integration/** and must never run twice.
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/api/test/integration/**'],
    pool: 'forks',
    update: false,
    passWithNoTests: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    minWorkers: 1,
    maxWorkers: 2,
    reporters: ['default'],
  },
});
