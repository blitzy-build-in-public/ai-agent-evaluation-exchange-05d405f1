/**
 * The single place a SQLite connection is opened for the ADEM server.
 *
 * A leaf module: the driver, two Node builtins and nothing else — no configuration module,
 * no migration runner and no domain package — so the path a connection is opened on arrives
 * purely as an argument, and this file never reads the environment or the working directory.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

/**
 * The in-memory database name SQLite defines, spelled the way the driver expects it.
 *
 * Named rather than repeated because it is asked about once and opened with once: a caller
 * that pads the name in whitespace is still asking for the in-memory database, and opening
 * the padded string instead would quietly create a file called ` :memory: `.
 */
const IN_MEMORY_PATH = ":memory:";

/**
 * Opens the one SQLite connection for a database path and returns a ready handle.
 *
 * Returns the `better-sqlite3` handle and nothing else: no pool, no connection cache, no
 * wrapper and no second connection, because the driver's API is synchronous and runs on the
 * calling thread, and because two handles on `:memory:` are two different, empty databases.
 * The caller that opens the handle owns closing it.
 *
 * Refuses a `path` that is not a non-empty string — including the `null` and `undefined` a
 * JavaScript caller can pass — with a `TypeError`. For a file path it creates the parent
 * directory first, so a fresh checkout's `.adem/` appears on first use; for the in-memory
 * name it creates nothing, that name not being a filesystem path.
 *
 * Requests `journal_mode = WAL`, `synchronous = FULL` and `foreign_keys = ON`, each as its
 * own statement outside any transaction. The mode that results is deliberately not asserted:
 * WAL on an in-memory database yields `memory` rather than an error, the integration suite
 * runs on one `:memory:` connection, and an assertion here would break every suite.
 *
 * A driver refusal — an unwritable directory, a corrupt or locked file — propagates as an
 * `Error` naming the path, with the driver's own error attached as `cause`. Nothing is
 * retried, nothing is swallowed and nothing is written to a stream.
 */
export function openDatabase(path: string): Database.Database {
  // Declared `string`, but a JavaScript caller can pass anything, so the runtime type is
  // established before the value is used as one. Nothing about the value is echoed back.
  const requested: unknown = path;
  if (typeof requested !== "string" || requested.trim().length === 0) {
    throw new TypeError("The `path` argument must be a non-empty database path.");
  }

  // The product opens either a real file path or the in-memory database; every other value
  // is treated as a file path and handed to the driver exactly as it was given.
  const isInMemory = requested.trim() === IN_MEMORY_PATH;
  const databasePath = isInMemory ? IN_MEMORY_PATH : requested;

  try {
    if (!isInMemory) {
      // `recursive` is what brings `.adem/` into being, the default path sitting in a
      // directory a fresh checkout does not have. A path with no directory component yields
      // ".", for which a recursive mkdir is a no-op.
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    const database = new Database(databasePath);

    // Outside any transaction on purpose: SQLite will not change the journal mode inside
    // one — it answers with the unchanged mode rather than raising — so the pragmas run on
    // the freshly opened connection, before any transaction exists. WAL is requested and
    // deliberately not asserted; see the note above.
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
    // SQLite leaves `foreign_keys` off by default and the setting is per connection, so the
    // schema's relationships hold only because every connection the server opens says so.
    database.pragma("foreign_keys = ON");

    return database;
  } catch (error) {
    throw new Error(`Unable to open the ADEM database at ${path}`, { cause: error });
  }
}
