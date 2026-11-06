import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end and accessibility configuration.
 *
 * One built application is served for the whole run from a fresh, temporary,
 * seeded SQLite file: `webServer.env.ADEM_DB_PATH` hands the built app its own
 * database, so no test needs hand-made data and no contributor database is touched.
 *
 * The listen port is derived from CLONE_INDEX because every agent on this host
 * runs its own checkout side by side: port = ADEM_PORT, else 4100 + 10 * CLONE_INDEX.
 * `baseURL` is set explicitly, since only `port` (never `url`) becomes `use.baseURL`.
 */
const cloneIndex = Number(process.env.CLONE_INDEX ?? '0');
const port = Number(process.env.ADEM_PORT ?? String(4100 + cloneIndex * 10));
const databasePath = join(mkdtempSync(join(tmpdir(), 'adem-e2e-')), 'adem.sqlite');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run seed && npm start',
    url: `http://127.0.0.1:${port}`,
    env: {
      ...process.env,
      ADEM_PORT: String(port),
      ADEM_DB_PATH: databasePath,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'loop',
      testMatch: ['developer-to-buyer.spec.ts', 'route-walk.spec.ts'],
    },
    {
      name: 'a11y-desktop',
      testMatch: ['a11y.spec.ts'],
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'a11y-mobile',
      testMatch: ['a11y.spec.ts'],
      use: { viewport: { width: 360, height: 800 } },
    },
  ],
});
