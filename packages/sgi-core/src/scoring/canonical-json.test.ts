import { describe, expect, it } from "vitest";

import type { JsonValue } from "@adem/sgi-fixtures";

import { canonicalize, UnrenderableValueError } from "./canonical-json";

/**
 * Unit tests for `canonicalize` from `./canonical-json`, the renderer that turns a candidate's
 * recorded output and a standard version's expected output into the two strings scoring compares.
 *
 * Every assertion below pins one property of the canonical form that AAP §0.8's determinism
 * invariant needs — key order is fixed and insignificant, array order and the bytes inside a
 * string value survive untouched, and the output carries no byte that only a pretty-printer
 * would add — so that one value renders one string on any machine, in any locale, on any run.
 *
 * The walk's totality is pinned here as well, because determinism needs it: a document nested
 * twenty thousand levels deep renders, and renders identically twice, because the depth of a value
 * is not a limit of the evaluator; while the values JSON has no canonical text for — one that
 * refers to itself, one holding a member that cannot be read, a number JSON cannot carry, one that
 * is not JSON data at all — refuse with the coded `UnrenderableValueError` rather than a raw engine
 * error.
 *
 * The behaviour is exercised through the function's arguments alone, which is why the module
 * loads no fixture file, opens no database and reads no environment.
 */

describe("canonicalize", () => {
  describe("object key order", () => {
    it("renders two objects that differ only in key order as the same string", () => {
      expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
      expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
      expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    });

    it("sorts the keys of a nested object as well as of the object holding it", () => {
      expect(canonicalize({ outer: { y: 1, x: 2 } })).toBe(canonicalize({ outer: { x: 2, y: 1 } }));
      expect(canonicalize({ outer: { y: 1, x: 2 } })).toBe('{"outer":{"x":2,"y":1}}');
    });
  });

  describe("objects nested inside arrays", () => {
    it("sorts an object held by an array element", () => {
      expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
    });

    it("sorts the record held inside an array element of a document", () => {
      const expected = canonicalize({ legs: [{ from: "north-yard", to: "east-yard" }] });

      expect(canonicalize({ legs: [{ to: "east-yard", from: "north-yard" }] })).toBe(expected);
      expect(expected).toBe('{"legs":[{"from":"north-yard","to":"east-yard"}]}');
    });
  });

  describe("the three distinct empties", () => {
    it("keeps an empty array, an empty object and null apart", () => {
      expect(canonicalize([])).toBe("[]");
      expect(canonicalize({})).toBe("{}");
      expect(canonicalize(null)).toBe("null");

      expect(canonicalize([])).not.toBe(canonicalize({}));
      expect(canonicalize([])).not.toBe(canonicalize(null));
      expect(canonicalize({})).not.toBe(canonicalize(null));
    });

    it("renders an empty sub-record as an empty object inside its document", () => {
      expect(canonicalize({ order_id: "demo-order-1015", handling: {} })).toBe(
        '{"handling":{},"order_id":"demo-order-1015"}',
      );
    });
  });

  describe("primitive values", () => {
    it("renders each primitive as its own JSON text", () => {
      const cases: ReadonlyArray<readonly [string | number | boolean | null, string]> = [
        [null, "null"],
        [true, "true"],
        [false, "false"],
        [0, "0"],
        [3, "3"],
        [1250, "1250"],
        ["", '""'],
        ["x", '"x"'],
      ];

      for (const [value, expected] of cases) {
        expect(canonicalize(value)).toBe(expected);
      }
    });

    it("treats negative zero as the same JSON number as zero", () => {
      // A negative zero is written as 0 by the JSON number format, so -0 and 0 canonicalise equal.
      expect(canonicalize(-0)).toBe("0");
      expect(canonicalize(-0)).toBe(canonicalize(0));
    });

    it("keeps a null value rather than dropping the key that holds it", () => {
      expect(canonicalize({ bay: null })).toBe('{"bay":null}');
    });
  });

  describe("whitespace inside a string value", () => {
    it("treats a trailing space inside a value as significant", () => {
      expect(canonicalize({ note: "pending review " })).toBe('{"note":"pending review "}');
      expect(canonicalize({ note: "pending review " })).not.toBe(
        canonicalize({ note: "pending review" }),
      );
    });
  });

  describe("array element order", () => {
    it("preserves the order of an array, which is data rather than formatting", () => {
      expect(canonicalize([1, 2])).toBe("[1,2]");
      expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
    });

    it("preserves the order of a list of codes held by a document", () => {
      expect(canonicalize({ scan_codes: ["sc-1100", "sc-2200", "sc-3300"] })).toBe(
        '{"scan_codes":["sc-1100","sc-2200","sc-3300"]}',
      );
      expect(canonicalize({ scan_codes: ["sc-1100", "sc-2200", "sc-3300"] })).not.toBe(
        canonicalize({ scan_codes: ["sc-2200", "sc-1100", "sc-3300"] }),
      );
    });
  });

  describe("non-ASCII characters", () => {
    it("keeps an accented character byte for byte, without escaping or transliterating it", () => {
      const accented = canonicalize({ note: "entreposer à l'abri" });

      expect(accented).toBe('{"note":"entreposer à l\'abri"}');
      expect(accented).toContain("à");
      expect(accented).not.toContain("\\u");
      expect(accented).not.toBe(canonicalize({ note: "entreposer a l'abri" }));
    });
  });

  describe("repeatability", () => {
    it("returns the same string for the same value and for a fresh but equal value", () => {
      const value = {
        order_id: "demo-order-1017",
        depot: "north-yard",
        status: "closed",
        item_count: 4,
      };
      const equalValue = {
        order_id: "demo-order-1017",
        depot: "north-yard",
        status: "closed",
        item_count: 4,
      };

      expect(canonicalize(value)).toBe(canonicalize(value));
      expect(canonicalize(value)).toBe(canonicalize(structuredClone(value)));
      expect(canonicalize(value)).toBe(canonicalize(equalValue));
    });
  });

  describe("whitespace between tokens", () => {
    it("writes no whitespace of its own between tokens", () => {
      const rendered = canonicalize({
        order_id: "demo-order-1001",
        items: ["crate-11", 12, true, null],
      });

      expect(rendered).toBe('{"items":["crate-11",12,true,null],"order_id":"demo-order-1001"}');
      expect(rendered).toMatch(/^\S*$/);
      expect(rendered).not.toMatch(/\s/);
    });

    it("keeps whitespace that sits inside a string value and adds none around it", () => {
      const rendered = canonicalize({ note: "pending review", bay: "north yard" });

      expect(rendered).toBe('{"bay":"north yard","note":"pending review"}');
      expect(rendered).not.toContain('": "');
      expect(rendered).not.toContain(", ");
    });
  });

  describe("the key sort order", () => {
    it("orders keys by UTF-16 code unit rather than by a locale's collation", () => {
      // A locale-sensitive sort would order these keys differently from machine to machine, so one
      // value would render several strings and the comparison would stop being reproducible.
      expect(canonicalize({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
      expect(canonicalize({ a: 1, B: 2, Z: 3 })).toBe('{"B":2,"Z":3,"a":1}');
    });
  });

  describe("totality at any depth, and the four refusals", () => {
    /**
     * The depth the documents below are nested to.
     *
     * Far past the depth a recursive walk reaches before it exhausts the call stack — the constraint
     * these documents probe — and well inside what `JSON.parse` accepts.
     */
    const DEPTH = 20000;

    /**
     * One well-formed document, as text, and the label its case is named by.
     *
     * Both of them have one key per level, so sorting the keys changes nothing and the canonical
     * form of the document is the text it was built from.
     */
    const deepDocuments: ReadonlyArray<readonly [string, string]> = [
      [
        "an array nested twenty thousand levels deep",
        `{"outer":${"[".repeat(DEPTH)}1${"]".repeat(DEPTH)}}`,
      ],
      [
        "an object nested twenty thousand levels deep",
        `{"outer":${'{"inner":'.repeat(DEPTH)}1${"}".repeat(DEPTH)}}`,
      ],
    ];

    it.each(deepDocuments)(
      "renders %s, byte for byte and identically on every call",
      (_description, text) => {
        const document = JSON.parse(text) as JsonValue;
        const rendered = canonicalize(document);

        // The same text back, and the same string for a second call on this value and on a fresh but
        // equal one: the depth costs memory in the walk rather than a JavaScript call frame per
        // level, so it neither changes a byte nor limits what can be rendered.
        expect(rendered).toBe(text);
        expect(canonicalize(document)).toBe(rendered);
        expect(canonicalize(JSON.parse(text) as JsonValue)).toBe(rendered);
      },
    );

    it("renders a sub-record two keys share rather than refusing it as a cycle", () => {
      const shared: JsonValue = { a: 1 };

      // Sharing is not a cycle: the record leaves the walk's set of ancestors as soon as its own
      // rendering ends, so a later key renders it again instead of being refused.
      expect(canonicalize({ p: shared, q: shared })).toBe('{"p":{"a":1},"q":{"a":1}}');
      expect(canonicalize([shared, shared])).toBe('[{"a":1},{"a":1}]');
    });

    const cyclic: Record<string, unknown> = { note: "pending review" };
    cyclic.self = cyclic;
    const revoked = Proxy.revocable({ a: 1 }, {});
    revoked.revoke();

    /**
     * One value JSON has no canonical text for, with the label its case is named by.
     *
     * `undefined` and the bigint are cast because handing one in is exactly what these cases are
     * about: the argument type says JSON data, and a caller can still pass a value that is not. The
     * non-finite numbers need no cast: `JSON.parse` reads the `1e999` a client can send as
     * `Infinity`, so a caller reaches one through ordinary JSON text, and `JSON.stringify` writes
     * each of them as `null` — which would compare equal to an expected `null` and store evidence
     * differing from the submission.
     */
    const unrenderable: ReadonlyArray<readonly [string, JsonValue]> = [
      ["a value that refers to itself", cyclic as unknown as JsonValue],
      ["a revoked proxy", revoked.proxy as unknown as JsonValue],
      ["undefined", undefined as unknown as JsonValue],
      ["a bigint", 1n as unknown as JsonValue],
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
      ["NaN", Number.NaN],
      ["the infinity JSON.parse reads from 1e999", JSON.parse("1e999") as JsonValue],
    ];

    it.each(unrenderable)(
      "refuses %s with the coded refusal rather than an engine error",
      (_description, value) => {
        let thrown: unknown = "the call returned instead of refusing";
        try {
          canonicalize(value);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(UnrenderableValueError);
        expect((thrown as UnrenderableValueError).code).toBe("unrenderable_value");
        expect((thrown as UnrenderableValueError).name).toBe("UnrenderableValueError");

        // Neither of the two engine errors such an input can produce: a caller gets a typed refusal
        // whose name it maps, not a raw engine error it has to recognise.
        expect(thrown).not.toBeInstanceOf(RangeError);
        expect(thrown).not.toBeInstanceOf(TypeError);
      },
    );

    it("attaches the engine error an unreadable member raised as the refusal's cause", () => {
      const revocable = Proxy.revocable({ a: 1 }, {});
      revocable.revoke();

      let thrown: unknown = "the call returned instead of refusing";
      try {
        canonicalize(revocable.proxy as unknown as JsonValue);
      } catch (error) {
        thrown = error;
      }

      // The message is this module's own words; the engine's error is kept beside it, because it is
      // the only record of why the member could not be read.
      expect(thrown).toBeInstanceOf(UnrenderableValueError);
      expect((thrown as UnrenderableValueError).cause).toBeInstanceOf(TypeError);
      expect((thrown as UnrenderableValueError).message).not.toContain("IsArray");
    });
  });
});
