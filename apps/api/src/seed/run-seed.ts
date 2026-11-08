/**
 * The `npm run seed` entry: applies the migrations and then the demo seed to the database
 * named by `ADEM_DB_PATH` (or the default `.adem/adem.sqlite`), logs the summary, and exits 0.
 * Refuses, exiting non-zero, when the database already contains data or a migration checksum
 * changed — and never leaves a partly written database behind.
 *
 * **The order is the contract.** The migrations are applied to the handle this file opened, and
 * only then is the seed run on that same handle, so the command works on a database file a fresh
 * checkout does not have yet, with nothing before it: the connection brings `.adem/` into being, the
 * runner creates the schema the seed's inserts name, and the seed fills it.
 *
 * **It runs once, against a fresh path.** `./seed-database`'s `seedDatabase` refuses a database
 * that already holds rows rather than emptying it, so a second run over a seeded database fails
 * loudly and changes nothing. In a container the documented path is therefore
 * `docker compose exec app npm run seed`: the service itself never seeds, which is what keeps a
 * restart on its persisted volume safe. The browser suites need no such care —
 * `playwright.config.ts` hands this command a fresh, run-unique file through
 * `webServer.env.ADEM_DB_PATH`, so `npm run seed && npm start` there always starts from nothing.
 *
 * **It is not importable by route code.** Nothing imports this file: the seed itself is
 * `seedDatabase` in `./seed-database`, which the integration harness calls against its own
 * in-memory connection, and this module exists only to be executed. That is why the work below runs
 * at module scope rather than behind an exported function — there is no caller to hand a result to,
 * and no second entry point to keep in step with the manifest's `seed` script.
 *
 * The one failure path writes a single line to standard error and sets a non-zero exit code, and
 * says nothing more: a stack trace belongs in a debugger, and this command's output is a terminal.
 * `process.exit` is deliberately absent from that path, so the `finally` block closes the
 * connection first and a refusal leaves no driver handle open behind it.
 */

import type { Database } from "better-sqlite3";

import { resolveConfig } from "../config";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { seedDatabase } from "./seed-database";
import type { SeedSummary } from "./seed-database";

/**
 * Writes one line per seeded table and one line per seeded report, each prefixed `seed: `, and
 * returns nothing.
 *
 * The counts are read from the database by `seedDatabase` and are printed in the order that module
 * states them, exactly as they arrived: nothing is summed, averaged or reformatted here, because a
 * total composed at the point of display would be this file's arithmetic rather than SQLite's
 * answer. No line carries a path, a SQL fragment or a secret, so the output is safe to paste into
 * an issue as it stands.
 *
 * Refuses nothing: it checks no input, because the summary it is given is the one `seedDatabase`
 * already built and returned, and a count or a report the seed did not produce cannot reach it.
 *
 * @param summary - The counts and reports `seedDatabase` returned for the database it seeded.
 */
function logSeedSummary(summary: SeedSummary): void {
  for (const [table, count] of Object.entries(summary.counts)) {
    console.log(`seed: ${table}=${count}`);
  }

  for (const report of summary.reports) {
    console.log(
      `seed: report candidate=${report.candidateId} version=${report.candidateVersionId} outcome=${report.outcome} report=${report.reportId}`,
    );
  }
}

// Module scope, on purpose: this file is the `seed` script's entry point and nothing imports it, so
// the statements below are the whole of its behaviour rather than the body of a function no call
// site would reach. `resolveConfig` is the only way configuration is read here — the environment
// variable that selects the database belongs to `../config`, and no path is derived in this file.
let database: Database | undefined;

try {
  // Resolved inside the `try` rather than above it, so a misconfigured `ADEM_PORT` or `ADEM_DB_PATH`
  // — the only refusal that can happen before a connection exists — reaches the same single-line
  // failure path below instead of an unhandled throw with a stack trace on the operator's terminal.
  const config = resolveConfig();
  database = openDatabase(config.databasePath);

  // Before the seed, on the handle just opened: the schema the seed's inserts name does not exist
  // on a fresh path, and an already-migrated database makes this call a no-op.
  const migration = runMigrations(database);

  // Reported so an operator can tell a first run from a repeated one over the same file, and so a
  // schema that advanced is visible in the output of the command that advanced it.
  console.log(`seed: migrations applied=${migration.appliedCount} version=${migration.highestVersion}`);

  logSeedSummary(seedDatabase(database));
} catch (error: unknown) {
  // One line, and the thrown message is the only detail carried into it. The seed's own refusal
  // names the database and the variable that selects another one, which is the remedy an operator
  // acts on, and the path such a refusal names is deliberately not a secret: it is the local file the
  // operator chose and naming it is what makes the refusal actionable. `seedDatabase`'s single
  // transaction is what guarantees the database holds nothing from this run, so there is no partial
  // state to describe or to clean up here.
  const detail =
    error instanceof Error ? error.message : "the seed could not be applied and the failure carried no message.";
  console.error(`seed: failed: ${detail}`);
  process.exitCode = 1;
} finally {
  // The connection this file opened is the connection it closes, on the success path and on the
  // failure path alike, and whether or not `openDatabase` ever returned one.
  database?.close();
}
