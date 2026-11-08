/**
 * The append-only write and the ordered read of `ledger_entries`: the single path that appends a
 * ledger row, and the read the three operator ledger surfaces are built from.
 *
 * **Insertion only, and that is the whole guarantee.** A ledger entry accepts exactly one kind of
 * write — a new row, appended — and no other statement against this table appears in this module:
 * there is no clause that rewrites a stored row, no upsert form and no conflict clause. A correction
 * to a ledger is a new row proportional to what it corrects, which is what lets each of the three
 * ledgers be read as history rather than as a balance, and it is why the refund path appends its
 * reversal rows rather than adjusting the charge they correct. `ledger_entries` is one of the nine
 * append-only tables that `packages/shared/migrations/0010_append_only_triggers.sql` guards with
 * abort triggers; those triggers are defence in depth and never a security boundary, since a
 * connection with write access can drop one, so the guarantee has to be held here — and it is, by
 * the single prepared statement below being an INSERT.
 *
 * **Insertion order, which is why the read orders by `rowid`.** A ledger is read in the sequence its
 * rows were appended, so a reversal appears after the entry it corrects. `created_at` cannot supply
 * that order: two rows appended within the same millisecond carry equal instants, and a caller that
 * pins the clock — a test, a deterministic fixture — gives them identical ones deliberately, so
 * ordering by that column would leave the sequence of such rows undefined. `rowid` is the table's own
 * insertion counter: every appended row receives a larger one than the row before it, whatever the
 * clock says.
 *
 * **The plural writer exists for the pair a refund appends.** A refund corrects two ledger rows at
 * once — the marketplace charge and the founder allocation that charge produced — so the two must
 * arrive together: a half-appended pair would leave two ledgers describing one transaction
 * differently, with nothing in either row to show it. {@link insertLedgerEntries} therefore appends
 * every entry it is given inside one transaction, so the pair is one act and not two.
 *
 * **This module holds no arithmetic, no label of its own, no vocabulary and no validation.** An
 * amount is computed by the caller — `allocate` beside this module is the product's single rounding
 * point — and both labels arrive on the input from the resolved configuration, because a row written
 * without the synthetic currency label and the nonfunctional-demonstration disclosure is an amount a
 * reader could mistake for a real one. Nothing is measured here and nothing is assigned here: no
 * field of a ledger row names an evaluation result or a person, so no commercial value reaches a
 * measurement through this table and no allocation is attributed to anyone.
 *
 * **Ports and adapters.** The database handle belongs to the caller: this module opens no connection,
 * reads no environment variable, resolves no path and touches no file.
 */

import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type {
  LedgerDirection,
  LedgerEntry,
  LedgerEntryInput,
  LedgerEntryType,
  LedgerName,
} from "./ledger-types";

/**
 * The caller's database handle, taken from the driver's own declaration so every module of this
 * package speaks about the same connection type.
 */
type SqliteDatabase = Database.Database;

/**
 * The one statement that appends a `ledger_entries` row: an explicit column list in the migration's
 * own order, one placeholder per column, no `*` and no value interpolated into the text. The eleven
 * values are bound positionally by {@link insertLedgerEntry} in exactly this order, so the statement
 * and its call site are read together.
 */
const INSERT_LEDGER_ENTRY_SQL = `INSERT INTO ledger_entries
  (id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
   currency_label, disclosure_label, description, created_at)
VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The one statement that reads a ledger back: the same explicit column list as the append, filtered
 * on the ledger discriminator so a row of one ledger is never handed to another ledger's read, and
 * ordered by `rowid` so the rows arrive in the sequence they were appended. See the module comment
 * for why `created_at` cannot serve as that order.
 */
const SELECT_LEDGER_ENTRIES_SQL = `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE ledger = ?
ORDER BY rowid ASC`;

/**
 * The stored shape of one `ledger_entries` row, declared under the table's own column names so a
 * column renamed in `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql` fails here
 * rather than passing as a row of another shape. Each field's type is the type of the corresponding
 * {@link LedgerEntry} field, `currency_label` included: the literal type of the product's one
 * synthetic label is derived from the entry rather than restated, so the two cannot drift apart.
 *
 * The driver returns `unknown` from `.get()` and `.all()` unless a result shape is supplied, which is
 * what the type argument on the prepared read supplies.
 */
interface LedgerEntryRow {
  /** Primary key of the row. */
  readonly id: string;
  /** The ledger the row belongs to. */
  readonly ledger: LedgerName;
  /** What the row records: a `charge`, an `allocation` or a `reversal`. */
  readonly entry_type: LedgerEntryType;
  /** Which side of the ledger the row falls on. */
  readonly direction: LedgerDirection;
  /** The amount, as a non-negative whole number of minor units of the synthetic currency. */
  readonly amount_minor_units: LedgerEntry["amount_minor_units"];
  /** `transactions.id` for a marketplace row, and `null` for a gate-fee row. */
  readonly transaction_id: string | null;
  /** `evaluation_reports.id` for a gate-fee row, and `null` for a marketplace row. */
  readonly report_id: string | null;
  /** The synthetic currency label; the column's `CHECK` admits no other value. */
  readonly currency_label: LedgerEntry["currency_label"];
  /** The nonfunctional-demonstration label every simulated amount carries. */
  readonly disclosure_label: string;
  /** Plain-language description of what the row records. */
  readonly description: string;
  /** The instant the row was appended, as an ISO-8601 UTC string. */
  readonly created_at: string;
}

/**
 * The clock {@link insertLedgerEntry} uses when its caller supplies none: an ISO-8601 UTC instant
 * with milliseconds and a trailing `Z`, never SQLite's `CURRENT_TIMESTAMP`, whose
 * `YYYY-MM-DD HH:MM:SS` form carries neither.
 */
const defaultNow = (): string => new Date().toISOString();

/**
 * Maps a stored row to the entry shape its readers are handed.
 *
 * The mapping is name for name: the table's column names and the entry's field names are the same
 * eleven names in the same order, so no field is renamed and no value is converted on the way out —
 * an amount stays the integer count of minor units the column holds, and no scaling, rounding or
 * text conversion belongs on a read path. It is written out rather than spread so that the
 * correspondence is readable in one place and so that a column added to the table surfaces here as a
 * field this function does not yet carry.
 */
function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    ledger: row.ledger,
    entry_type: row.entry_type,
    direction: row.direction,
    amount_minor_units: row.amount_minor_units,
    transaction_id: row.transaction_id,
    report_id: row.report_id,
    currency_label: row.currency_label,
    disclosure_label: row.disclosure_label,
    description: row.description,
    created_at: row.created_at,
  };
}

/**
 * Appends one ledger entry and returns the row that was appended.
 *
 * The row is built in memory from the caller's nine values and the two generated here, and the
 * returned value is that row rather than a re-read of it — which proves nothing either way, since an
 * append-only row cannot have changed, and the caller's own `201` payload is built from it.
 *
 * `input.now` is the injectable clock, defaulting to {@link defaultNow}. It lives on the input object
 * rather than as a further parameter so that a caller holding a batch of entries can pin each entry's
 * instant where the entry itself is built; it is not a field of the row and therefore never reaches
 * the returned entry, whose eleven properties are the row's own. A caller that needs a fixed instant
 * — a test, a deterministic fixture — supplies one; a caller that supplies none gets the system clock.
 *
 * This function refuses nothing: it is storage, and every refusal on the ledger path is taken before
 * it is reached. Whether a fee applies, whether an allocation is eligible, what an amount is and that
 * it is a whole number of minor units are decided upstream, and the HTTP-facing input is validated by
 * the request schemas. The only failures that can surface from here are the database's own — the
 * foreign keys, the `CHECK` constraints including the pair that keeps a transaction reference and a
 * report reference from co-occurring, and the abort triggers of
 * `packages/shared/migrations/0010_append_only_triggers.sql` — and they propagate unwrapped rather
 * than being re-shaped into an outcome this module would have to invent.
 *
 * @param db The caller's database handle.
 * @param input The nine stored values, plus the optional clock this call appends the row under.
 * @returns The appended entry: the caller's nine values with the generated identifier and instant.
 */
export function insertLedgerEntry(
  db: SqliteDatabase,
  input: LedgerEntryInput & { readonly now?: () => string },
): LedgerEntry {
  const now = input.now ?? defaultNow;

  // The row is composed field by field rather than spread from the input: the input carries the
  // optional clock, and spreading it would let that function travel into the returned entry — which
  // is handed to a caller as a stored row and to a `201` payload as a record, and is not the place
  // for a value the table has no column for.
  const entry: LedgerEntry = {
    id: randomUUID(),
    ledger: input.ledger,
    entry_type: input.entry_type,
    direction: input.direction,
    amount_minor_units: input.amount_minor_units,
    transaction_id: input.transaction_id,
    report_id: input.report_id,
    currency_label: input.currency_label,
    disclosure_label: input.disclosure_label,
    description: input.description,
    created_at: now(),
  };

  db.prepare(INSERT_LEDGER_ENTRY_SQL).run(
    entry.id,
    entry.ledger,
    entry.entry_type,
    entry.direction,
    entry.amount_minor_units,
    entry.transaction_id,
    entry.report_id,
    entry.currency_label,
    entry.disclosure_label,
    entry.description,
    entry.created_at,
  );

  return entry;
}

/**
 * Appends every entry it is given, in the order it is given them, and returns the appended rows in
 * that same order.
 *
 * The entries are appended inside one transaction, so the batch is one act: this is the writer the
 * refund path reaches for when it appends the pair of reversals a refund rules, and a batch that
 * failed halfway would otherwise leave the marketplace ledger and the founder-allocation ledger
 * telling different stories about one transaction with no row recording the difference. An empty
 * input appends nothing and answers with an empty array: a caller with no entries to append is a
 * state and not a failure.
 *
 * Each input may carry its own `now`, so a batch can be appended under one pinned instant or under
 * an instant per entry; an input without one is appended under the system clock, exactly as
 * {@link insertLedgerEntry} does when called on its own.
 *
 * Like {@link insertLedgerEntry} it refuses nothing of its own: a refusal reaches the caller
 * unwrapped from the database, and if one does, the transaction leaves no row of this batch behind.
 *
 * @param db The caller's database handle.
 * @param inputs The entries to append, in the order they are to be appended.
 * @returns One appended entry per input, in input order, each carrying its generated identifier and
 *   insertion instant. An empty input returns an empty array.
 */
export function insertLedgerEntries(
  db: SqliteDatabase,
  inputs: readonly (LedgerEntryInput & { readonly now?: () => string })[],
): LedgerEntry[] {
  const appendBatch = db.transaction(
    (entries: readonly (LedgerEntryInput & { readonly now?: () => string })[]): LedgerEntry[] => {
      const appended: LedgerEntry[] = [];

      for (const entry of entries) {
        appended.push(insertLedgerEntry(db, entry));
      }

      return appended;
    },
  );

  return appendBatch(inputs);
}

/**
 * Returns every entry of one of the three ledgers, in insertion order, and an empty array when that
 * ledger holds no rows.
 *
 * The rows are filtered on the ledger discriminator rather than read from three tables, because one
 * table holds all three ledgers and `ledger` is what separates them: a row of the marketplace ledger
 * is therefore never handed to the gate-fee read or the founder-allocation read, and each of the
 * three operator surfaces sees only its own history.
 *
 * The empty array is deliberate rather than convenient: an unused ledger is a state the product
 * answers with its `200` and an empty list, never an error, and the return type states the emptiness
 * outright so no caller has to guard against an absent result.
 *
 * This function refuses nothing and throws nothing of its own: an unknown ledger name cannot reach it
 * through the type, and a ledger with no rows is answered with an empty array rather than a refusal.
 *
 * @param db The caller's database handle.
 * @param ledger The ledger to read, one of the three names.
 * @returns The ledger's entries in insertion order, oldest first, each an appended row.
 */
export function listLedgerEntries(db: SqliteDatabase, ledger: LedgerName): LedgerEntry[] {
  const rows = db.prepare<[LedgerName], LedgerEntryRow>(SELECT_LEDGER_ENTRIES_SQL).all(ledger);

  return rows.map((row) => toLedgerEntry(row));
}
