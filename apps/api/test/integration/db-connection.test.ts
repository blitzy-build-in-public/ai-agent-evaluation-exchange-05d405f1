/**
 * The integration proof of `openDatabase` from `apps/api/src/db/connection.ts`: the one place the
 * ADEM server opens a SQLite connection.
 *
 * What it evidences, in the terms the plan states them: a fresh checkout's `.adem/` directory
 * appears on first use, so the default database path needs no preparation; the in-memory database
 * opens without touching the filesystem at all; the three pragmas the plan names —
 * `journal_mode = WAL`, `synchronous = FULL` (`2`) and `foreign_keys = ON` (`1`) — are in force on
 * the returned handle and were requested outside any transaction, which the connection reports as
 * `inTransaction === false`; a `path` that is not a non-empty string is refused with a `TypeError`
 * before anything is opened; and a refusal by the driver itself reaches the caller as an `Error`
 * naming the path, with the driver's own error attached as `cause` rather than swallowed.
 *
 * It is an integration suite rather than a beside-source unit test because every case here is a
 * property of a real path on a real filesystem — the directory that has to come into being, the file
 * SQLite creates there, and the two pragmas that are only observable on an open handle. Each case
 * works in a temporary directory of its own and closes every handle it opened afterwards.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/db/connection";

/** Handles this file opened, closed after each case so no case can leave a database behind. */
const openHandles: Database.Database[] = [];

/** Temporary directories this file created, removed after each case. */
const tempDirectories: string[] = [];

/** Creates a temporary directory of this file's own and records it for removal. */
function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "adem-db-"));
  tempDirectories.push(directory);
  return directory;
}

/** Opens a path through the module under test and records the handle for cleanup. */
function openTracked(path: string): Database.Database {
  const handle = openDatabase(path);
  openHandles.push(handle);
  return handle;
}

/**
 * Runs `action` and returns the value it threw, so a refusal can be read rather than merely counted.
 *
 * A `TypeError` and a driver error each carry the message and the `cause` a caller acts on, and only
 * the thrown value itself carries either, so the thrown value is what the cases below assert on.
 */
function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to throw, but it returned normally");
}

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    if (handle.open) {
      handle.close();
    }
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("openDatabase on a file path", () => {
  it("creates the parent directory a fresh checkout does not have and requests the three pragmas", () => {
    const directory = makeTempDirectory();
    const parent = join(directory, "nested", "deeper");
    const path = join(parent, "adem.sqlite");

    // A fresh checkout carries no `.adem/`, and neither does this path's directory: the module is
    // what has to bring it into being, one absent level at a time.
    expect(existsSync(parent)).toBe(false);

    const handle = openTracked(path);

    expect(existsSync(parent)).toBe(true);
    expect(existsSync(path)).toBe(true);

    // `simple: true` answers the bare value rather than a `{ journal_mode: "wal" }` row.
    expect(handle.pragma("journal_mode", { simple: true })).toBe("wal");
    // `synchronous = FULL` is level 2 and `foreign_keys = ON` reads back as 1.
    expect(handle.pragma("synchronous", { simple: true })).toBe(2);
    expect(handle.pragma("foreign_keys", { simple: true })).toBe(1);

    // SQLite answers an unchanged journal mode rather than raising when the request is made inside a
    // transaction, so the three pragmas above are only in force because the module asked for them on
    // the freshly opened connection and left no transaction open behind them.
    expect(handle.inTransaction).toBe(false);
  });
});

describe("openDatabase on the in-memory name", () => {
  it("opens :memory: without creating anything on the filesystem", () => {
    const directory = makeTempDirectory();
    const entriesBefore = readdirSync(directory);

    const handle = openTracked(":memory:");

    // WAL is requested and SQLite answers `memory` for an in-memory database instead of failing,
    // which is why the mode is asserted as exactly that and never as `wal`.
    expect(handle.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(handle.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.inTransaction).toBe(false);

    // The driver's own answer about what it opened: the in-memory database rather than a file.
    expect(handle.name).toBe(":memory:");

    // No file and no journal: the name is not a path, so nothing about opening it reaches a disk.
    expect(readdirSync(directory)).toStrictEqual(entriesBefore);
  });

  it("treats a whitespace-padded in-memory name as the in-memory database", () => {
    // The module names `:memory:` once and trims the argument before comparing it, so a padded
    // caller still asks for the in-memory database rather than for a file called ` :memory: `.
    const handle = openTracked("  :memory:  ");

    expect(handle.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(handle.name).toBe(":memory:");
  });
});

describe("openDatabase refusals", () => {
  it("refuses a path that is not a non-empty string with a TypeError", () => {
    const emptyRefusal = thrownBy(() => openDatabase(""));

    expect(emptyRefusal).toBeInstanceOf(TypeError);
    // Observed wording: "The `path` argument must be a non-empty database path."
    expect((emptyRefusal as Error).message).toContain("must be a non-empty database path");

    // Whitespace is not a path either: the check is on the trimmed value, so padding cannot stand in
    // for a name.
    expect(() => openDatabase("   ")).toThrow(TypeError);

    // A JavaScript caller reaches this function with whatever it has, and the runtime type is
    // established before the value is used as a path — the two below included.
    const nullPath = null as unknown as string;
    const undefinedPath = undefined as unknown as string;
    expect(() => openDatabase(nullPath)).toThrow(TypeError);
    expect(() => openDatabase(undefinedPath)).toThrow(TypeError);
  });

  it("propagates a driver refusal as an Error naming the path, with the driver's error as cause", () => {
    const directory = makeTempDirectory();
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "a regular file, so no directory can be made at this path\n");

    // The parent of the path below is a regular file: the directory it needs cannot exist, so the
    // driver refuses the database.
    const path = join(blocker, "child.sqlite");
    const refusal = thrownBy(() => openDatabase(path));

    expect(refusal).toBeInstanceOf(Error);
    const error = refusal as Error;
    // Observed wording: "Unable to open the ADEM database at <path>", with the driver's own
    // `SqliteError` (SQLITE_CANTOPEN) attached as `cause`.
    expect(error.message).toContain(path);
    expect(error.cause).toBeInstanceOf(Error);
    expect(existsSync(path)).toBe(false);
  });
});
