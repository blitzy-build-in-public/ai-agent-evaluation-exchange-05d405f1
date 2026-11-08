import { defineConfig } from 'vitest/config';

/**
 * Unit suite: in-process, per workspace, no HTTP server and no database file.
 *
 * A unit test sits beside its source as <name>.test.ts, in any workspace and for the
 * scripts' own tests, so a new test file is discovered by placing it there: this
 * configuration is the only place the unit suite's files are found.
 *
 * One of the scripts' tests does not run in the unit leg. The exclusion scan's own
 * self-test, scripts/scan-exclusions.test.ts, has its own entry point — `npm run test:scan`,
 * which `npm test` runs — and a filename filter selects from the files a configuration
 * includes, so leaving it in both would collect and execute it twice. The `test:unit`
 * script therefore excludes that one file on the command line, and every other
 * <name>.test.ts under scripts/, scripts/deps-report.test.ts in particular, still runs
 * here. No test file is collected by two entry points and each test runs exactly once.
 *
 * `pool: 'forks'` runs every test file in a forked process rather than a worker
 * thread. packages/sgi-core and packages/commerce-sim load the better-sqlite3 native
 * addon, so a process per file keeps that addon, its file handles and each test's own
 * in-memory database isolated and reproducible.
 *
 * The snapshot update mode is not settable from this file: Vitest 1.6 derives it during
 * config resolution from `update`, the UPDATE_SNAPSHOT variable and CI, overriding any
 * `snapshotOptions` block a config carries — which is a type error against InlineConfig
 * as well as inert. `update: false` is Vitest's own default, kept as the one statement of
 * intent a config file can make. The mode it resolves to turns on CI: where CI is set, as
 * it is for the test workflow's `npm test`, the mode is `none`, so a missing, mismatched
 * or obsolete baseline fails the run instead of being rewritten; without it, as in a
 * `npm run test:unit`, the mode is `"new"`, so that local run would record a baseline.
 * No snapshot exists in the tree today, so nothing is at risk until a suite adds one, and
 * regenerating a baseline stays an explicit act: `vitest run --update`.
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
