import { describe, expect, it } from "vitest";

import { createApprovalStore } from "./approvals";
import type { ApprovalRecord } from "./approvals";

/**
 * The approval checkpoint's contract.
 *
 * `evaluate` asks this store one question — whether an approval was recorded for a
 * call id — and answers `allow` with reason `approved` for a call it had blocked
 * with `needs_approval` when the answer is yes. This suite fixes both halves of
 * that contract: what a recorded approval makes visible, and what the store refuses
 * to do. Unapproved is the default, the call id is the whole key, and the interface
 * has no way to edit or remove what it holds.
 *
 * Every timestamp here is a fixed literal, because Shield reads no clock and the
 * suite proves reproducible behaviour.
 */

/** The timestamp every generated approval in this suite carries. */
const APPROVAL_AT = "1970-01-01T00:00:00.000Z";

/**
 * Builds a complete approval record for a call id out of fixed literals — no clock
 * and no generated identifier — so a recorded approval is identical in every run.
 */
function approvalFor(callId: string, approvedBy = "demo-approver"): ApprovalRecord {
  return {
    callId,
    approvedBy,
    reason: `released ${callId} after review`,
    at: APPROVAL_AT,
  };
}

/**
 * Reads the stored record for a call id, failing with a readable message rather than
 * a null reference when the store holds none.
 */
function storedRecord(store: ReturnType<typeof createApprovalStore>, callId: string): ApprovalRecord {
  const record = store.getApproval(callId);
  if (record === null) {
    throw new Error(`expected the store to hold an approval for ${callId}`);
  }
  return record;
}

/**
 * Builds a complete approval record for a call id whose named member is an accessor that raises
 * when it is read, so a caller-supplied record whose members cannot be read can be shown to be
 * ignored rather than raised on. Everything else about it is a complete, ordinary record.
 */
function unreadableRecord(member: "callId" | "approvedBy" | "reason" | "at"): ApprovalRecord {
  const record = approvalFor("call-1");
  Object.defineProperty(record, member, {
    configurable: true,
    enumerable: true,
    get: () => {
      throw new Error(`the record's ${member} cannot be read`);
    },
  });
  return record;
}

describe("the approval store", () => {
  describe("default state", () => {
    it("reports no approval for a call id that was never recorded", () => {
      const store = createApprovalStore();

      expect(store.hasApproval("call-1")).toBe(false);
      expect(store.getApproval("call-1")).toBeNull();
      expect(store.listApprovals()).toEqual([]);
    });
  });

  describe("recording an approval", () => {
    it("returns the recorded approval with all four fields intact", () => {
      const store = createApprovalStore();

      store.recordApproval({
        callId: "call-1",
        approvedBy: "demo-approver",
        reason: "the approver saw this call and released it",
        at: APPROVAL_AT,
      });

      expect(store.hasApproval("call-1")).toBe(true);
      expect(store.getApproval("call-1")).toEqual({
        callId: "call-1",
        approvedBy: "demo-approver",
        reason: "the approver saw this call and released it",
        at: APPROVAL_AT,
      });
    });
  });

  describe("keyed by call id alone", () => {
    it("does not answer for another call id", () => {
      const store = createApprovalStore();

      store.recordApproval(approvalFor("call-1"));

      expect(store.hasApproval("call-2")).toBe(false);
      expect(store.getApproval("call-2")).toBeNull();
    });

    it("matches the call id exactly, so a padded, recased or extended id stays unapproved", () => {
      const store = createApprovalStore();

      store.recordApproval(approvalFor("call-1"));

      expect(store.hasApproval("call-1 ")).toBe(false);
      expect(store.hasApproval(" call-1")).toBe(false);
      expect(store.hasApproval("CALL-1")).toBe(false);
      expect(store.hasApproval("call-10")).toBe(false);
    });
  });

  describe("the first approval for a call id", () => {
    it("wins, and a later approval for the same id changes nothing", () => {
      const store = createApprovalStore();

      store.recordApproval({
        callId: "call-1",
        approvedBy: "first-approver",
        reason: "first approval",
        at: "1970-01-01T00:00:00.000Z",
      });
      store.recordApproval({
        callId: "call-1",
        approvedBy: "second-approver",
        reason: "second approval",
        at: "1971-01-01T00:00:00.000Z",
      });

      expect(store.getApproval("call-1")).toEqual({
        callId: "call-1",
        approvedBy: "first-approver",
        reason: "first approval",
        at: "1970-01-01T00:00:00.000Z",
      });
      expect(store.listApprovals()).toHaveLength(1);
    });
  });

  describe("append-only surface", () => {
    it("exposes record, has, get and list, and offers no delete and no update", () => {
      const store = createApprovalStore();

      expect(Object.keys(store).sort()).toEqual([
        "getApproval",
        "hasApproval",
        "listApprovals",
        "recordApproval",
      ]);
      expect("deleteApproval" in store).toBe(false);
      expect("updateApproval" in store).toBe(false);
    });

    it("never loses a recorded approval, so its count only grows", () => {
      const store = createApprovalStore();

      for (const [index, callId] of ["call-1", "call-2", "call-3"].entries()) {
        store.recordApproval(approvalFor(callId));

        // Each recording adds exactly one record and neither replaces nor drops an earlier one, so
        // the count after the nth call id is n. Asserting that exact count is what fails for a
        // store that loses a record, where "no fewer than before" holds even for one that records
        // nothing at all.
        expect(store.listApprovals()).toHaveLength(index + 1);
      }

      store.recordApproval(approvalFor("call-1"));

      expect(store.listApprovals()).toHaveLength(3);
      expect(store.listApprovals().map((record) => record.callId)).toEqual(["call-1", "call-2", "call-3"]);
    });
  });

  describe("listApprovals", () => {
    it("returns every record in the order it was recorded", () => {
      const store = createApprovalStore();

      store.recordApproval(approvalFor("call-1", "first-approver"));
      store.recordApproval(approvalFor("call-2", "second-approver"));
      store.recordApproval(approvalFor("call-3", "first-approver"));

      expect(store.listApprovals().map((record) => record.callId)).toEqual(["call-1", "call-2", "call-3"]);
      expect(store.listApprovals().map((record) => record.approvedBy)).toEqual([
        "first-approver",
        "second-approver",
        "first-approver",
      ]);
    });

    it("hands back a new array, so editing what it returns cannot change the store", () => {
      const store = createApprovalStore();

      store.recordApproval(approvalFor("call-1"));

      const listed = store.listApprovals();
      listed.pop();
      listed.push(approvalFor("call-99"));

      expect(store.listApprovals()).not.toBe(listed);
      expect(store.hasApproval("call-99")).toBe(false);
      expect(store.getApproval("call-1")).toEqual(approvalFor("call-1"));
      expect(store.listApprovals().map((record) => record.callId)).toEqual(["call-1"]);
    });
  });

  describe("the records it holds", () => {
    it("are frozen, so the stored history cannot be edited from outside", () => {
      const store = createApprovalStore();

      store.recordApproval(approvalFor("call-1"));
      store.recordApproval(approvalFor("call-2"));

      expect(Object.isFrozen(storedRecord(store, "call-1"))).toBe(true);
      expect(store.listApprovals().every((record) => Object.isFrozen(record))).toBe(true);
    });

    it("carry no field for the tool or the arguments of the call, so the call id is the whole key", () => {
      const store = createApprovalStore();

      store.recordApproval(approvalFor("call-1"));

      expect(Object.keys(storedRecord(store, "call-1")).sort()).toEqual([
        "approvedBy",
        "at",
        "callId",
        "reason",
      ]);
      // Whatever call bears the id is therefore released, which is why a caller must
      // give every call a unique id and show the approver the call itself.
      expect(store.hasApproval("call-1")).toBe(true);
    });
  });

  describe("a record without a usable call id", () => {
    it("is ignored and leaves the call blocked, without throwing", () => {
      const store = createApprovalStore();

      expect(() => {
        store.recordApproval({ callId: "", approvedBy: "demo-approver", reason: "no call named", at: APPROVAL_AT });
      }).not.toThrow();

      expect(store.hasApproval("")).toBe(false);
      expect(store.getApproval("")).toBeNull();
      expect(store.listApprovals()).toEqual([]);
    });

    it("is ignored when an untyped caller passes null instead of a record", () => {
      const store = createApprovalStore();

      // @ts-expect-error — the runtime guard, not the type, is what refuses this: the
      // expectation proves it holds for a caller that ignores the types.
      expect(() => store.recordApproval(null)).not.toThrow();

      expect(store.listApprovals()).toEqual([]);
    });

    it.each(["callId", "approvedBy", "reason", "at"] as const)(
      "is ignored, leaving the call blocked and the store empty, when its %s cannot be read",
      (member) => {
        const store = createApprovalStore();

        expect(() => store.recordApproval(unreadableRecord(member))).not.toThrow();

        expect(store.listApprovals()).toEqual([]);
        expect(store.hasApproval("call-1")).toBe(false);
        expect(store.getApproval("call-1")).toBeNull();
        // Nothing was recorded for the call the unreadable record named, so the complete record
        // that follows is still the first approval that id receives, and it is stored whole.
        store.recordApproval(approvalFor("call-1"));
        expect(storedRecord(store, "call-1")).toEqual(approvalFor("call-1"));
      },
    );

    it("is ignored when the record itself cannot be read at all, leaving the call blocked", () => {
      const store = createApprovalStore();
      const revocable = Proxy.revocable(approvalFor("call-1"), {});
      revocable.revoke();

      expect(() => store.recordApproval(revocable.proxy)).not.toThrow();

      expect(store.listApprovals()).toEqual([]);
      expect(store.hasApproval("call-1")).toBe(false);
      expect(store.getApproval("call-1")).toBeNull();
      // A record nobody can read supplies no approval event, so it leaves the call blocked and a
      // complete record for the same id is still the first one recorded.
      store.recordApproval(approvalFor("call-1"));
      expect(storedRecord(store, "call-1")).toEqual(approvalFor("call-1"));
    });
  });

  describe("two stores", () => {
    it("share no state, so an approval in one is invisible in the other", () => {
      const first = createApprovalStore();
      const second = createApprovalStore();

      first.recordApproval(approvalFor("call-1"));

      expect(first.hasApproval("call-1")).toBe(true);
      expect(second.hasApproval("call-1")).toBe(false);
      expect(second.getApproval("call-1")).toBeNull();
      expect(second.listApprovals()).toEqual([]);
      expect(first.listApprovals()).toHaveLength(1);
    });
  });
});
