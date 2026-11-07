import { describe, expect, it } from "vitest";

import { canonicalize } from "./canonical-json";

/**
 * Unit tests for `canonicalize` from `./canonical-json`, the renderer that turns a candidate's
 * recorded output and a standard version's expected output into the two strings scoring compares.
 *
 * Every assertion below pins one property of the canonical form that AAP §0.8's determinism
 * invariant needs — key order is fixed and insignificant, array order and the bytes inside a
 * string value survive untouched, and the output carries no byte that only a pretty-printer
 * would add — so that one value renders one string on any machine, in any locale, on any run.
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
});
