/**
 * The browser suites' configuration: one built application started by the `webServer`, and exactly
 * three projects, so that each documented script selects its own specs and nothing else.
 *
 * `npm run test:e2e` is `playwright test --project=loop` and `npm run test:a11y` is the two
 * accessibility projects, so the project names below are a contract with the root manifest rather
 * than a naming convenience. `loop` carries the developer-to-buyer loop, the route walk and the
 * rendered sponsorship label; `a11y-desktop` and `a11y-mobile` carry the accessibility checks and
 * the no-horizontal-scroll assertion at 1280 px and at 360 px. A spec is collected by the one
 * project whose `testMatch` names it, which is what keeps the two scripts from overlapping.
 *
 * **A fresh database on every run.** The suite hands the application it starts a database file
 * whose name is unique to this run, inside the gitignored `.adem/` directory, through
 * `webServer.env.ADEM_DB_PATH`. `npm run seed` refuses a database that already holds rows, so a
 * path that cannot repeat is what lets `npm run seed && npm start` seed on every run without
 * anything deleting a file that another process may be holding.
 *
 * **The port belongs to the clone, not to the host.** Several checkouts run their suites on one
 * machine at the same time, so the port is `4100 + 10 * CLONE_INDEX`, the block this clone is
 * assigned, and the same number is given to both the spawned application (as `ADEM_PORT`, the only
 * way it learns a port) and `baseURL`. `CLONE_INDEX` and `CI` are the only two environment values
 * this file reads, and a checkout that sets neither still runs: clone 0's block is the default and
 * `CI` only selects the two switches described below.
 *
 * **The build must already have run.** `npm start` serves `apps/web/dist`, so `npm run build`
 * precedes these suites. A checkout without that directory is not a crashed server — the API
 * starts, serves its own routes and answers a page request with its not-found envelope, which the
 * readiness check does not accept. The check therefore polls the API's own listing read,
 * `GET /api/v1/listings`, which the server answers with or without the bundle, and a missing build
 * surfaces as a failing page assertion rather than as a web server that never came up.
 */

import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * The clone index an environment that names none is treated as: the first block, so a lone
 * checkout needs no environment value.
 */
const DEFAULT_CLONE_INDEX = 0;

/** The first port of clone 0's block. */
const PORT_BLOCK_BASE = 4100;

/** How many consecutive ports one clone's block holds. */
const PORT_BLOCK_SIZE = 10;

/** The highest port number a host can carry: a block that starts above it names no address. */
const HIGHEST_PORT = 65_535;

/**
 * The first port of a clone's block, from its index alone.
 *
 * The one place the block layout is written down: `cloneIndex` bounds the index with it and the port
 * the spawned application and `baseURL` are both given comes from it, so the two cannot drift apart.
 *
 * @param index The clone's index.
 * @returns The port that clone's block starts at.
 */
function blockPort(index: number): number {
  return PORT_BLOCK_BASE + PORT_BLOCK_SIZE * index;
}

/**
 * The clone's index, read from `CLONE_INDEX`.
 *
 * A value that is not a whole number zero or greater is refused rather than defaulted: it would
 * place this suite's server in another clone's port block, and the collision that follows is far
 * harder to read than a refusal that names the variable — the same choice `apps/api/src/config.ts`
 * makes for the two values it reads.
 *
 * An index too large to carry is refused on the same ground. A host has 65535 ports, so the highest
 * index this block layout can hold is 6143, whose block starts at 65530; above it no address exists
 * for the block, and the run would fail far from here with an error that names neither `CLONE_INDEX`
 * nor the number that was set.
 *
 * @returns The configured index, or {@link DEFAULT_CLONE_INDEX} when nothing is set.
 * @throws {Error} If `CLONE_INDEX` is set and is not a whole number zero or greater, or if its block
 * would start at a port above {@link HIGHEST_PORT}.
 */
function cloneIndex(): number {
  const configured = process.env.CLONE_INDEX?.trim();

  if (configured === undefined || configured === "") {
    return DEFAULT_CLONE_INDEX;
  }

  const index = Number(configured);

  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`CLONE_INDEX must be a whole number zero or greater, received ${JSON.stringify(configured)}`);
  }

  const firstPort = blockPort(index);

  if (firstPort > HIGHEST_PORT) {
    throw new Error(
      `CLONE_INDEX must name a port block within 1-65535, received ${JSON.stringify(configured)}, which would start at port ${firstPort}`,
    );
  }

  return index;
}

const port = blockPort(cloneIndex());

/**
 * The address the suites navigate to, set explicitly because `webServer.port` — not the `url` the
 * readiness check polls — is the only source Playwright derives a `baseURL` from, and this file
 * declares no `port`. The specs therefore navigate with paths relative to it.
 */
const baseURL = `http://127.0.0.1:${port}`;

/**
 * The read the readiness check polls: the API's own paginated listing endpoint, the first row of its
 * contract table and a route `npm start` answers whatever else is on disk.
 *
 * A page request would be the wrong probe. The pages come from the built bundle, so a checkout that
 * has not run `npm run build` answers `/` with its not-found envelope, and the readiness check takes
 * only 2xx, 3xx and 400–403 from the url it polls: the probe would retry until `timeout` expired and
 * the run would die before a single spec was collected. This read belongs to the server rather than
 * to the bundle, so the server counts as ready as soon as it serves its own contract, and a missing
 * build reaches the page assertions these suites are made of.
 */
const READINESS_PATH = "/api/v1/listings";

/**
 * The database file this run's application is given: a name unique to the run, so it cannot hold
 * rows from an earlier one, inside `.adem/`, which the repository ignores.
 */
const databasePath = join(process.cwd(), ".adem", `e2e-${process.pid}-${Date.now()}.sqlite`);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Serial with no retry: `loop` writes listings, reports, inquiries and transactions onto the same
  // seeded data the route walk asserts against, so a single worker is what keeps the two from
  // interfering, and a retry would hide exactly the non-determinism these suites exist to catch.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    // The seed first: it applies the migrations and writes the demo rows into the fresh file, and
    // only then does the server open that file. `npm run build` is deliberately not part of this
    // command — it belongs to the contributor's own step, and repeating it here would rebuild the
    // web bundle on every suite run.
    command: "npm run seed && npm start",
    url: `${baseURL}${READINESS_PATH}`,
    env: {
      ADEM_PORT: String(port),
      ADEM_DB_PATH: databasePath,
    },
    // Locally, a server already running on this clone's port is reused; in CI the suite always
    // starts its own, so a server someone left up cannot mask a start-up that is broken.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  // Chromium only, because the one browser this project documents downloading is Chromium: the
  // desktop descriptor is spread and the viewport then set explicitly, rather than a mobile device
  // descriptor being used, which would switch the browser the mobile check runs in.
  projects: [
    {
      name: "loop",
      testMatch: ["e2e/developer-to-buyer.spec.ts", "e2e/route-walk.spec.ts"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "a11y-desktop",
      testMatch: "e2e/a11y.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "a11y-mobile",
      testMatch: "e2e/a11y.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } },
    },
  ],
});
