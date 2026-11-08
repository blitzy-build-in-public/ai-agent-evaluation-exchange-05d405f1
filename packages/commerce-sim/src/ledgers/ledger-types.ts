/**
 * The ledger vocabulary and the two entry shapes of the simulated commerce package: the closed
 * lists every `ledger_entries` row draws its values from, and the row's insert shape derived from
 * its read shape.
 *
 * **One declaration site.** The three vocabularies and the row interface are declared once, in
 * `@adem/shared` (`packages/shared/src/types/ledger.ts`), and this module re-exports them for the
 * package, so the `CHECK` constraints of migration `0008`, the JSON Schema enums the operator
 * ledger routes validate against and the type checker all read the same three lists. Nothing here
 * redeclares a list or a union: a second copy of a closed vocabulary starts disagreeing with the
 * first the moment either changes, which is why this module holds re-exports and one derived type
 * and no literal list of its own.
 *
 * **The direction convention.** `direction` records which side of the ledger an entry falls on,
 * read *relative to the ledger the entry sits in*: a `charge` is a `debit`, an `allocation` is a
 * `credit`, and a `reversal` carries the opposite direction of the entry it corrects. Those three
 * pairings are this package's own definition rather than a figure quoted from elsewhere, so read
 * them here instead of looking for a specification that does not state them. The kind of an entry
 * is carried by `entry_type` alone, and `direction` is never the sign of the amount — amounts are
 * non-negative whole numbers of minor units of the synthetic `DEMO` currency and no negative
 * amount is ever stored, so a reader who took `direction` for a sign would build a second,
 * contradictory rule on top of the first.
 *
 * **Insertion only.** A ledger entry is append-only: the one write the row accepts is a new row
 * appended to the table, and a correction — the reversal a refund appends, say — is a new row
 * proportional to what it corrects rather than a change to the row it corrects. That is what lets
 * each of the three ledgers be read as history in insertion order, and what makes the net position
 * of a simulated transaction a value derived from its rows rather than a balance stored beside
 * them. The row-level abort triggers created by
 * `packages/shared/migrations/0010_append_only_triggers.sql` stand behind the rule as defence in
 * depth and never as a security boundary; what makes it hold is that no route rewrites such a row.
 *
 * **Nothing here measures anything, and nothing here belongs to anyone.** No field of these shapes
 * names an evaluation result, so no commercial value reaches an evaluation through them, and the
 * founder-allocation ledger carries no personal identity, beneficiary account or entitlement: an
 * entry is a computed share of a simulated transaction and assigns it to no one.
 *
 * Re-exports and one type alias only — no function, no runtime value of this module's own and no
 * validation. The half-up allocation arithmetic lives in `allocate.ts` beside this module.
 */

import type { LedgerEntry } from "@adem/shared";

// The closed vocabularies as runtime values, so a caller can enumerate the members a schema enum
// or a `CHECK` constraint is built from.
export { LEDGER_DIRECTIONS, LEDGER_ENTRY_TYPES, LEDGER_NAMES } from "@adem/shared";

// The unions those tuples derive, plus the row interface itself, carried through as types.
export type { LedgerDirection, LedgerEntry, LedgerEntryType, LedgerName } from "@adem/shared";

/**
 * The insert shape of a `ledger_entries` row: the read shape without the two columns the writer
 * generates.
 *
 * `id` and `created_at` are produced as the row is written, so a writer may not supply them, and
 * deriving this shape from {@link LedgerEntry} rather than restating the remaining fields is what
 * keeps a row and an insert from drifting apart: a column added to the row reaches every writer
 * that consumes this shape without an edit here.
 *
 * The row references **either** a transaction **or** a report and **never both**, so
 * `transaction_id` and `report_id` are required fields holding an explicit `null` for the absent
 * side — a gate-fee entry carries the report it was charged for, while a marketplace charge, its
 * allocation or that allocation's reversal carries the transaction. Every entry carries the
 * synthetic currency label and its nonfunctional-demonstration disclosure label, because an amount
 * written without them is an amount a reader could mistake for a real one.
 */
export type LedgerEntryInput = Omit<LedgerEntry, "id" | "created_at">;
