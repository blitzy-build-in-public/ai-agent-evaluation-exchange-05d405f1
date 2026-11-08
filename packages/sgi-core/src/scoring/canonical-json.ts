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
 * Raised when a value has no canonical JSON text.
 *
 * It carries the machine-readable code `unrenderable_value` — never a raw engine error name, which
 * is what a caller maps to its own refusal — and it is the one failure {@link canonicalize} raises,
 * for the four inputs JSON cannot carry as text: a value that refers to itself, a member that
 * cannot be read, a number JSON cannot represent, and a value that is not JSON data at all.
 *
 * `cause` is set for a member that could not be read and holds the engine's own error — the
 * `TypeError` a revoked `Proxy` raises, for instance. The message never repeats that error's text:
 * a caller reads this class's `code` and its `message`, and the cause is there for a log.
 */
export class UnrenderableValueError extends Error {
  /** The machine-readable code a caller maps, never a raw engine error name. */
  readonly code = "unrenderable_value" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnrenderableValueError";
  }
}

/**
 * Renders one JSON value as its canonical JSON text.
 *
 * The function is total and byte-stable over every JSON value, **at any depth**: everything a JSON
 * document can carry renders, two calls on equal values return equal strings, and the depth a value
 * is nested to is not a limit of the evaluator — the walk below keeps its pending work in an
 * explicit stack on the heap, so one more level costs memory rather than one more JavaScript call
 * frame, and a recording nested twenty thousand levels deep renders and scores.
 *
 * It refuses exactly four things, with an {@link UnrenderableValueError} carrying the
 * machine-readable code `unrenderable_value`, rather than letting a raw engine error out:
 *
 * - A value that **refers to itself**, directly or through a container it holds. JSON carries a
 *   tree, and a graph that holds itself has no text.
 * - A **member that cannot be read** — a revoked `Proxy`, an accessor that throws. The engine's own
 *   error is attached as the refusal's `cause`, because it is the record of why the member could not
 *   be read; the message a caller reads is this module's own words.
 * - A **number JSON cannot represent** — `Infinity`, `-Infinity` and `NaN`, each of which
 *   `JSON.stringify` writes as `null`. `JSON.parse` reaches them from ordinary JSON text (`1e999`
 *   parses to `Infinity`), and a value silently rendered as `null` would compare equal to an
 *   expected `null` and would store evidence that differs from what the candidate submitted.
 * - A value that is **not JSON data at all** — `undefined`, a function, a symbol, a bigint — whose
 *   type the message names.
 *
 * The "never throws, whatever the value" an earlier version of this comment promised was
 * unkeepable: a revoked `Proxy` cannot be read and a cyclic value has no JSON text, so the only open
 * question was whether that failure arrived as a typed, coded refusal a caller can map or as a raw
 * engine error. It arrives as the former.
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
 *   commerce simulation package, which nothing here reaches. A number the JSON
 *   data model cannot express — `Infinity`, `-Infinity` and `NaN` — is refused as
 *   `unrenderable_value` rather than rendered, because `JSON.stringify` writes one
 *   as `null`: a value silently rendered as `null` would compare equal to an
 *   expected `null` and would store evidence differing from what was submitted.
 *   `-0` renders as `0`, so `-0` and `0` canonicalise equal.
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
 * @throws {UnrenderableValueError} when `value` refers to itself, holds a member that cannot be
 * read, is a number JSON cannot represent, or is a value that is not JSON data. The error carries
 * `code: "unrenderable_value"`, so a caller maps a stable code rather than reading whichever name
 * the engine's own error happened to have.
 */
export function canonicalize(value: JsonValue): string {
  const frames: Frame[] = [{ kind: "value", value }];
  const out: string[] = [];
  // The containers on the path from the root to the frame being rendered, so a value that holds
  // itself can be told apart from one that is merely shared. A container joins the set when its
  // children are scheduled and leaves it in its own `leave` frame, which is popped after them: a
  // set of everything seen anywhere instead of this one would refuse a legitimate value, because
  // `{p: shared, q: shared}` is a tree and both of its copies render.
  const ancestors = new Set<object>();

  try {
    let frame = frames.pop();
    while (frame !== undefined) {
      if (frame.kind === "text") {
        out.push(frame.text);
      } else if (frame.kind === "leave") {
        ancestors.delete(frame.container);
      } else if (isContainer(frame.value)) {
        scheduleContainer(frame.value, frames, ancestors);
      } else if (frame.value === null) {
        out.push("null");
      } else if (typeof frame.value === "string") {
        out.push(JSON.stringify(frame.value));
      } else if (typeof frame.value === "number") {
        // `JSON.stringify` writes `null` for `Infinity`, `-Infinity` and `NaN`, and `JSON.parse`
        // reaches those from ordinary JSON text — `1e999` parses to `Infinity`, and a submission's
        // recorded output is unconstrained data. A number silently rendered as `null` would compare
        // equal to an expected `null` and would store evidence stating `null` rather than what was
        // submitted, so the value is refused here instead of being rewritten to one nobody sent.
        if (!Number.isFinite(frame.value)) {
          throw new UnrenderableValueError(
            `the number ${String(frame.value)} is not a value JSON data can carry, so it has no canonical JSON text`,
          );
        }
        out.push(JSON.stringify(frame.value));
      } else if (typeof frame.value === "boolean") {
        out.push(frame.value ? "true" : "false");
      } else {
        throw new UnrenderableValueError(
          `a value of type ${typeof frame.value} is not JSON data, so it has no canonical JSON text`,
        );
      }
      frame = frames.pop();
    }
  } catch (error) {
    // Every read that can fail on foreign input — `Array.isArray` on a revoked proxy, the accessor
    // `Object.entries` invokes, an element read — fails here instead of leaving as an engine error,
    // which is what makes the typed refusal above the whole story of what this function raises.
    if (error instanceof UnrenderableValueError) {
      throw error;
    }
    throw new UnrenderableValueError(
      "one of the value's members could not be read, so the value has no canonical JSON text",
      { cause: error },
    );
  }

  return out.join("");
}

/**
 * One frame of {@link canonicalize}'s work stack: a piece of text already decided, a value still to
 * render, or the departure of a container from the set of ancestors.
 *
 * The three kinds are one union rather than three stacks because a frame's position in the stack is
 * when it is emitted, and the order of the three is what the output is.
 */
type Frame =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "leave"; readonly container: object };

/**
 * Whether the value is a container JSON carries: an array or a record.
 *
 * This predicate is what narrows a value frame to the shape {@link scheduleContainer} takes.
 * `null` reads as `"object"` to `typeof` and is excluded here explicitly rather than by the branch
 * that renders it, because `null` is a JSON scalar with a rendering of its own.
 */
function isContainer(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Schedules one container's frames onto the walk's stack, in the reverse of the order they are
 * emitted, so that popping one frame at a time yields the container's text in output order.
 *
 * The container's own `leave` frame is pushed first and is therefore popped last, after every frame
 * of every descendant: that is what keeps {@link canonicalize}'s set of ancestors holding exactly
 * the containers on the current path. A container already in that set is its own ancestor, and is
 * refused here rather than walked again — which is the difference between a graph, which JSON has
 * no text for, and a sub-record two keys share, which is a tree and renders.
 */
function scheduleContainer(container: object, frames: Frame[], ancestors: Set<object>): void {
  if (ancestors.has(container)) {
    throw new UnrenderableValueError(
      "the value refers to itself, through a container it holds, so it has no canonical JSON text",
    );
  }
  ancestors.add(container);
  frames.push({ kind: "leave", container });

  // A container's frames are built in the order they are emitted and then reversed onto the stack
  // as a block. A separator belongs between two children, so it is written before every child but
  // the first.
  const body: Frame[] = [];

  if (Array.isArray(container)) {
    for (const element of container) {
      if (body.length > 0) {
        body.push({ kind: "text", text: "," });
      }
      body.push({ kind: "value", value: element });
    }
    frames.push({ kind: "text", text: "]" });
    pushReversed(frames, body);
    frames.push({ kind: "text", text: "[" });
    return;
  }

  // Keys are sorted by an explicit `<`/`>` comparator, which orders them by UTF-16 code
  // units. Sorting by a locale's collation rules instead — the locale-aware string
  // comparison a reader might reach for — would order the keys differently on machines
  // with different locales, so one value would render several strings and the comparison
  // would stop being reproducible. The comparator is written out rather than left to
  // `sort()`'s implicit default — also code-unit based, but invisible here — so the
  // decision survives the next reader's edit.
  const entries = Object.entries(container).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [key, entry] of entries) {
    if (body.length > 0) {
      body.push({ kind: "text", text: "," });
    }
    body.push({ kind: "text", text: JSON.stringify(key) });
    body.push({ kind: "text", text: ":" });
    body.push({ kind: "value", value: entry });
  }
  frames.push({ kind: "text", text: "}" });
  pushReversed(frames, body);
  frames.push({ kind: "text", text: "{" });
}

/**
 * Pushes a container's frames onto the walk's stack in the reverse of the order they are emitted,
 * so the frame on top of the stack is the next piece of text that container contributes.
 *
 * `body` is the container's own freshly built frame list, which no other step holds, so reversing
 * it here is a decision inside one walk step rather than a mutation of a caller's array.
 */
function pushReversed(frames: Frame[], body: Frame[]): void {
  for (const frame of body.reverse()) {
    frames.push(frame);
  }
}
