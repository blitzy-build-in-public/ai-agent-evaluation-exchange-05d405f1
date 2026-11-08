/**
 * The append-only write and the bounded, ordered read of `ledger_entries`: the single path that
 * appends a ledger row, the read the three operator ledger surfaces are built from, and the count that
 * states how many entries the ledger holds in all.
 *
 * **Insertion only, and that is the whole guarantee.** A ledger entry accepts exactly one kind of
 * write — a new row, appended — and no other statement against this table appears in this module:
 * there is no clause that rewrites a stored row, no upsert form and no conflict clause. A correction
 * to a ledger is a new row proportional to what it corrects, which is what lets each of the three
 * ledgers be read as history rather than as a balance, and it is why the refund path appends its
 * reversal rows rather than adjusting the charge they correct. `ledger_entries` is one of the nine
 * append-only tables that `packages/shared/migrations/0010_append_only_triggers.sql` guards with
 * abort triggers; those triggers are defence in depth and never a security boundary, since a
 * connection with write access can drop one, so the guarantee has to be held here — and it is, by the
 * INSERT below being this module's only statement that touches a stored row: the read and the count
 * beside it are SELECTs, and neither changes a row.
 *
 * **Insertion order, which is why the read orders by `rowid`.** A ledger is read in the sequence its
 * rows were appended, so a reversal appears after the entry it corrects. `created_at` cannot supply
 * that order: two rows appended within the same millisecond carry equal instants, and a caller that
 * pins the clock — a test, a deterministic fixture — gives them identical ones deliberately, so
 * ordering by that column would leave the sequence of such rows undefined. `rowid` is the table's own
 * insertion counter: every appended row receives a larger one than the row before it, whatever the
 * clock says.
 *
 * **The read is bounded, and page 1 is the newest page.** `ledger_entries` grows with every simulated
 * checkout, every evaluation that records a gate fee and every refund, so no read here hands back the
 * whole history: {@link listLedgerEntries} reads one window of it — by default the newest page, of
 * `COLLECTION_PAGE_SIZE` entries — and {@link countLedgerEntries} states how many entries the ledger
 * holds in all, which is what lets a caller tell a short ledger from a clipped page. The window is
 * applied by SQLite (`ORDER BY rowid DESC LIMIT ? OFFSET ?`) rather than by reading the table and
 * slicing it in memory, so the cost of a page does not grow with the history behind it, and the rows of
 * the page are reversed on the way out so that one page still reads oldest first, exactly as the
 * paragraph above promises. The window is a read-side bound only: {@link insertLedgerEntry} and
 * {@link insertLedgerEntries} are unchanged, and the write path is still the single INSERT below.
 *
 * **The plural writer exists for the pair a refund appends.** A refund corrects two ledger rows at
 * once — the marketplace charge and the founder allocation that charge produced — so the two must
 * arrive together: a half-appended pair would leave two ledgers describing one transaction
 * differently, with nothing in either row to show it. {@link insertLedgerEntries} therefore appends
 * every entry it is given inside one transaction, so the pair is one act and not two.
 *
 * **This module holds no arithmetic, no label of its own, no vocabulary and no validation of an
 * entry.** An amount is computed by the caller — `allocate` beside this module is the product's single
 * rounding point — and both labels arrive on the input from the resolved configuration, because a row
 * written without the synthetic currency label and the nonfunctional-demonstration disclosure is an
 * amount a reader could mistake for a real one. Nothing is measured here and nothing is assigned here:
 * no field of a ledger row names an evaluation result or a person, so no commercial value reaches a
 * measurement through this table and no allocation is attributed to anyone. The one value this module
 * does refuse is a page window that is not a window, since SQLite would read a negative `limit` as no
 * limit at all and the read would silently stop being bounded; that refusal is stated on
 * {@link listLedgerEntries} and concerns the read's own page, never an entry's values.
 *
 * **Ports and adapters.** The database handle belongs to the caller: this module opens no connection,
 * reads no environment variable, resolves no path and touches no file.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";

import { COLLECTION_PAGE_SIZE } from "@adem/shared";

import { renderReceived } from "../config";
import type {
  LedgerDirection,
  LedgerEntry,
  LedgerEntryInput,
  LedgerEntryType,
  LedgerName,
} from "./ledger-types";

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
 * The window of one page of a ledger read: how many entries the page may carry, and how many of the
 * ledger's newest entries it starts past.
 *
 * Both members are supplied by the caller of {@link listLedgerEntries} rather than read from a
 * configuration, because the page to answer is the caller's request and the page size is the product's:
 * `apps/api` builds the window from the request's `page` and the shared `COLLECTION_PAGE_SIZE`, so one
 * definition of the page size serves the API and this read alike.
 *
 * `offset` counts from the newest end of the history, which is the end {@link listLedgerEntries} reads
 * from: offset `0` is the page holding the entries appended last, offset `COLLECTION_PAGE_SIZE` the page
 * before it, and so on back through the ledger. Within a page the entries are in insertion order, so a
 * reversal appears after the entry it corrects.
 */
export interface LedgerEntryWindow {
  /** How many entries the page may carry: a positive whole number. */
  readonly limit: number;
  /** How many of the ledger's newest entries the page skips: a non-negative whole number. */
  readonly offset: number;
}

/**
 * The window {@link listLedgerEntries} reads when its caller supplies none: the first, most recent page
 * of the ledger, of the product's one fixed page size.
 *
 * It is frozen so that the default cannot be mutated out from under a caller, and it is not exported:
 * a caller with no page to state wants exactly this window, and a caller with one states it.
 */
const DEFAULT_LEDGER_ENTRY_WINDOW: LedgerEntryWindow = Object.freeze({
  limit: COLLECTION_PAGE_SIZE,
  offset: 0,
});

/**
 * The one statement that reads a page of a ledger back: the same explicit column list as the append,
 * filtered on the ledger discriminator so a row of one ledger is never handed to another ledger's read,
 * and windowed over the newest end of the history. See the module comment for why `created_at` cannot
 * serve as the order and why `rowid` can.
 *
 * `rowid DESC` is the insertion order read backwards, so the first row of the window is the entry
 * appended last: page 1 is therefore the newest page of the ledger — the entries an operator opens the
 * surface to see — and each later page reaches one page further back. `LIMIT` and `OFFSET` are both
 * bound parameters, so no number a client sent reaches this statement's text, and the window is applied
 * by SQLite rather than by reading the ledger and slicing the rows in memory. The caller reverses the
 * rows a page read, so one page is answered in insertion order.
 */
const SELECT_LEDGER_ENTRIES_SQL = `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE ledger = ?
ORDER BY rowid DESC
LIMIT ? OFFSET ?`;

/**
 * The one statement that counts a ledger: how many rows the table holds for the same discriminator the
 * page read filters on, over the same predicate.
 *
 * The count is what makes a bounded read usable rather than merely smaller: a reader that wants the rest
 * of a ledger asks for the next page, and a reader that wants to know how much ledger there is reads
 * this number without a second page request. It is deliberately taken over the same `WHERE ledger = ?`
 * the page is read with, so `total` and the page cannot disagree about which ledger they describe, and
 * it is served by `idx_ledger_entries_ledger`, the index `0011_indexes.sql` declares for this column.
 */
const COUNT_LEDGER_ENTRIES_SQL = `SELECT COUNT(*) AS total FROM ledger_entries WHERE ledger = ?`;

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
 * The one-column shape {@link countLedgerEntries} reads back: the `total` alias its `COUNT(*)` is
 * selected under.
 *
 * It is declared rather than inferred because the driver returns `unknown` from `.get()` unless a result
 * shape is supplied, and because `COUNT(*)` is an integer count rather than a row: this is the only
 * place the number's name is stated.
 */
interface LedgerEntryCountRow {
  /** How many rows the counted predicate matched. */
  readonly total: number;
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
  db: Database,
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
  db: Database,
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
 * Returns one page of one of the three ledgers, in insertion order, and an empty array when that page
 * holds no rows.
 *
 * The page is one window of the ledger's history and never the whole of it: `ledger_entries` grows with
 * every checkout, every recorded gate fee and every refund, so a read that returned every row would grow
 * with the ledger. `window` states how many entries the page may carry and how many of the ledger's
 * newest entries it starts past — see {@link LedgerEntryWindow} — and a caller that supplies none reads
 * the ledger's first, most recent page, of {@link COLLECTION_PAGE_SIZE} entries. What the page holds is
 * answered in insertion order, oldest first, which is the order the module comment fixes: the rows are
 * read from the newest end and reversed, so a page whose window starts one page further back still reads
 * oldest-to-newest within itself, and a reversal still appears after the entry it corrects whenever the
 * two fall on the same page.
 *
 * The rows are filtered on the ledger discriminator rather than read from three tables, because one
 * table holds all three ledgers and `ledger` is what separates them: a row of the marketplace ledger
 * is therefore never handed to the gate-fee read or the founder-allocation read, and each of the
 * three operator surfaces sees only its own history. {@link countLedgerEntries} answers how many
 * entries that ledger holds in all, which is what a caller needs to tell a short ledger from a clipped
 * page and to know when the page it asked for was past the last one.
 *
 * The empty array is deliberate rather than convenient: an unused ledger, and a page past the last one,
 * are states the product answers with its `200` and an empty list, never an error, and the return type
 * states the emptiness outright so no caller has to guard against an absent result.
 *
 * What it refuses: a window whose `limit` is not a positive whole number, or whose `offset` is not a
 * non-negative whole number, is refused with a `RangeError` rather than bound as given, because SQLite
 * reads a negative `LIMIT` as no limit at all — a mistyped window would silently restore the whole-table
 * read this function exists to bound. Nothing else is refused: an unknown ledger name cannot reach it
 * through the type, and a ledger with no rows is answered with an empty array rather than a refusal.
 *
 * @param db The caller's database handle.
 * @param ledger The ledger to read, one of the three names.
 * @param window The page to read: at most `limit` entries per page, `offset` newest entries skipped.
 *   Defaults to the ledger's first, most recent page of {@link COLLECTION_PAGE_SIZE} entries.
 * @returns The page's entries in insertion order, oldest first within the page, each an appended row.
 * @throws {RangeError} If `window.limit` is not a positive whole number or `window.offset` is not a
 *   non-negative whole number. The message names the offending member.
 */
export function listLedgerEntries(
  db: Database,
  ledger: LedgerName,
  window: LedgerEntryWindow = DEFAULT_LEDGER_ENTRY_WINDOW,
): LedgerEntry[] {
  if (!Number.isSafeInteger(window.limit) || window.limit < 1) {
    throw new RangeError(
      `listLedgerEntries: window.limit must be a positive whole number, received ${renderReceived(window.limit)}`,
    );
  }

  if (!Number.isSafeInteger(window.offset) || window.offset < 0) {
    throw new RangeError(
      `listLedgerEntries: window.offset must be a non-negative whole number, received ${renderReceived(window.offset)}`,
    );
  }

  const rows = db
    .prepare<[LedgerName, number, number], LedgerEntryRow>(SELECT_LEDGER_ENTRIES_SQL)
    .all(ledger, window.limit, window.offset);

  // The window is read from the newest end so that page 1 is the most recent page of the ledger; the
  // page itself is answered as insertion order, which is the order this read documents and the order a
  // ledger's reader expects within a page. Reversing one page does not change the order of the pages.
  return rows.reverse().map((row) => toLedgerEntry(row));
}

/**
 * Counts the entries one of the three ledgers holds, in all of its history.
 *
 * This is the number a bounded read cannot answer by itself: {@link listLedgerEntries} returns one page
 * of at most `COLLECTION_PAGE_SIZE` rows, so a caller holding a page of twenty has no way to know
 * whether the ledger holds twenty or twenty thousand without it. It is counted over exactly the
 * predicate the page is read with, so the two always describe the same ledger.
 *
 * The count is a read and not a derivation: no amount is summed, no entry is inspected and nothing is
 * grouped, so a ledger whose amounts are integer minor units of the synthetic currency is counted
 * without any arithmetic of the product's own. `COUNT(*)` over a predicate with no grouping answers
 * exactly one row on every call, including the empty ledger, which holds `0` rather than nothing.
 *
 * @param db The caller's database handle.
 * @param ledger The ledger to count, one of the three names.
 * @returns How many entries that ledger holds in all: `0` for a ledger no row was appended to.
 */
export function countLedgerEntries(db: Database, ledger: LedgerName): number {
  const row = db.prepare<[LedgerName], LedgerEntryCountRow>(COUNT_LEDGER_ENTRIES_SQL).get(ledger);

  return row?.total ?? 0;
}
