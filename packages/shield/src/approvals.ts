/**
 * The approval checkpoint for Shield calls that were blocked with `needs_approval`.
 *
 * A blocked call is released only once an approval record naming that call id has
 * been recorded here: `evaluate` asks this store whether the call id has an
 * approval, and answers `allow` with reason `approved` when it does. The store is
 * keyed by call id alone and is append-only — it offers no update and no delete —
 * and it holds no decision vocabulary of its own: `Decision` belongs to the policy
 * layer, and nothing recorded here can affect any outcome other than the release
 * of the call it names.
 */

/**
 * A recorded approval for one Shield call that was blocked with `needs_approval`.
 */
export interface ApprovalRecord {
  /** The call this approval covers; the only key this store uses. */
  callId: string;
  /** The approver label supplied by the caller, such as a synthetic demo handle. */
  approvedBy: string;
  /** Why the approval was granted. */
  reason: string;
  /**
   * ISO-8601 timestamp of the approval, supplied by the caller. Shield never
   * reads the clock, so a caller that passes a fixed value keeps its decisions
   * reproducible.
   */
  at: string;
}

/**
 * The append-only approval checkpoint for calls blocked with `needs_approval`.
 */
export interface ApprovalStore {
  /**
   * Records the first approval for a call id and returns nothing; a record
   * without a usable call id, and a record whose members cannot be read at all,
   * are both ignored (leaving the call blocked) and this method never throws.
   * The caller learns the outcome through
   * {@link ApprovalStore.hasApproval} or {@link ApprovalStore.getApproval}.
   */
  recordApproval(approval: ApprovalRecord): void;
  /**
   * Answers whether an approval for this exact call id has been recorded. It
   * never guesses and never widens a blocked call: any id other than the
   * non-empty string id an approval was recorded under answers `false`.
   */
  hasApproval(callId: string): boolean;
  /**
   * Returns the stored record for a call id, or `null` when none was recorded.
   */
  getApproval(callId: string): ApprovalRecord | null;
  /**
   * Returns every stored record in insertion order, as a new array, and never
   * removes one.
   */
  listApprovals(): ApprovalRecord[];
}

/**
 * Creates an independent, in-memory approval store.
 *
 * The store indexes records by call id alone — not by tool name, arguments or
 * policy version — so it answers one question only: was an approval recorded for
 * this call id. Its history cannot be edited through it: a stored record is
 * frozen at insertion, the first approval recorded for a call id wins, and
 * `listApprovals` hands back a fresh array.
 *
 * Because the call id is the whole key, an approval is not bound to the call's
 * tool or arguments, so Shield does not verify that the approved call is the call
 * the approver looked at. A caller must therefore give every call a unique id and
 * show the call itself to the approver, so that the approval names the call the
 * approver actually saw.
 *
 * @returns A store whose state is private to it; two stores share nothing.
 */
export function createApprovalStore(): ApprovalStore {
  const approvals = new Map<string, ApprovalRecord>();

  function isUsableCallId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  /**
   * Reads the call id from a value that may be anything at all, including the
   * `null` and `undefined` an untyped JavaScript caller can pass. `null` means
   * the value cannot be matched to a call, which leaves that call blocked.
   */
  function readCallId(approval: unknown): string | null {
    if (typeof approval !== 'object' || approval === null) {
      return null;
    }
    const callId: unknown = (approval as { callId?: unknown }).callId;
    return isUsableCallId(callId) ? callId : null;
  }

  function recordApproval(approval: ApprovalRecord): void {
    try {
      const callId = readCallId(approval);
      if (callId === null || approvals.has(callId)) {
        return;
      }
      const record: ApprovalRecord = {
        callId,
        approvedBy: approval.approvedBy,
        reason: approval.reason,
        at: approval.at,
      };
      approvals.set(callId, Object.freeze(record));
    } catch {
      // The promise that this method never throws outranks a record it cannot read, so the call-id
      // read and the three member reads sit inside this one guard. A record whose members raise —
      // an accessor that throws, a revoked proxy — is ignored rather than raised on, and the guard
      // records nothing: no default and no empty string stands in for a member that could not be
      // read, the record is built in full before any of it is stored, and the call that unreadable
      // record might have named is therefore left blocked, exactly as an absent record leaves it.
    }
  }

  function hasApproval(callId: string): boolean {
    return isUsableCallId(callId) && approvals.has(callId);
  }

  function getApproval(callId: string): ApprovalRecord | null {
    if (!isUsableCallId(callId)) {
      return null;
    }
    return approvals.get(callId) ?? null;
  }

  function listApprovals(): ApprovalRecord[] {
    return [...approvals.values()];
  }

  return {
    recordApproval,
    hasApproval,
    getApproval,
    listApprovals,
  };
}
