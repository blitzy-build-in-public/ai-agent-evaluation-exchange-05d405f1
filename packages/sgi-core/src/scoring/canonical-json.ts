/**
 * The canonical-JSON renderer of ADEM's Standard Gate Index: the single producer
 * of the byte-stable text in which a candidate's recorded output and a standard
 * version's expected output are compared.
 *
 * Scoring compares two canonical strings and never two object graphs, because
 * property order alone would otherwise decide whether a candidate passed. The
 * canonical form fixes that order — object keys are sorted — and drops every
 * byte that carries no information, emitting no space, tab or newline between
 * tokens, so one JSON value renders one string on any machine, in any locale, on
 * any run.
 *
 * The distinction the `SGI-SO-1.0.0` fixture set exists to prove is the two
 * sides of whitespace:
 *
 * - Whitespace **between tokens** is insignificant. Case `so-017` states an
 *   object's keys in a different order from its expected output — a difference no
 *   reader of the JSON can observe — and must match.
 * - Whitespace **inside a string value** is significant. Case `so-018` records a
 *   note with a trailing space its expected output does not carry, and must not
 *   match. Case `so-014` is the third probe: it records the same array elements
 *   in a different order and must not match either, because array order is data.
 *
 * Nothing here reads a clock, a locale, a timezone, a random source, a file, an
 * environment variable or a database: a plain JSON value goes in and a string
 * comes out, which is what lets the same submission score identically twice.
 */

import type { JsonValue } from "@adem/sgi-fixtures";

/**
 * Renders one JSON value as its canonical JSON text.
 *
 * The function is total and byte-stable: it never throws, whatever the value, and
 * two calls on equal values return equal strings.
 *
 * - `null` renders as `null`; a boolean as `true` or `false`.
 * - A **string** renders exactly as its value reads, byte for byte: non-ASCII
 *   characters are kept as they are, and only the characters JSON requires to be
 *   escaped — a quote, a backslash, a control character — are escaped. A trailing
 *   space inside a value therefore survives, which is what case `so-018` depends
 *   on.
 * - A **number** renders in `JSON.stringify`'s own shortest round-trip form. The
 *   fixture data carries small non-negative integers, so no rounding question
 *   arises here and no rounding rule is invented in this file: the product's one
 *   documented half-up rounding point is the founder-allocation arithmetic in the
 *   commerce simulation package, which nothing here reaches. Two values the JSON
 *   data model cannot express consequently need no branch — `NaN` and `Infinity`
 *   are not JSON values — and `-0` renders as `0`, so `-0` and `0` canonicalise
 *   equal.
 * - An **array** renders its elements in order, separated by `,` inside `[` and
 *   `]`. The order is preserved exactly: elements are never sorted and never
 *   deduplicated, because their order is data.
 * - An **object** renders its entries with the keys sorted by UTF-16 code-unit
 *   comparison, each key emitted as JSON text before its `:` and its canonical
 *   value, inside `{` and `}`.
 *
 * Outside a string the only characters emitted are `{`, `}`, `[`, `]`, `,` and
 * `:`; the insignificant whitespace a pretty-printer would add is never written.
 *
 * @param value - The JSON value to render, as a standard version's expected
 * output or a candidate's recorded output supplies it.
 * @returns The canonical JSON text of `value`.
 */
export function canonicalize(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  // Keys are sorted by an explicit `<`/`>` comparator, which orders them by UTF-16 code
  // units. Sorting by a locale's collation rules instead — the locale-aware string
  // comparison a reader might reach for — would order the keys differently on machines
  // with different locales, so one value would render several strings and the comparison
  // would stop being reproducible. The comparator is written out rather than left to
  // `sort()`'s implicit default — also code-unit based, but invisible here — so the
  // decision survives the next reader's edit.
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}
