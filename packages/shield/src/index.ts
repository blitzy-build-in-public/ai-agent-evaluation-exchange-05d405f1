/**
 * The single public entry of `@adem/shield` — ADEM Shield Basic.
 *
 * It exposes a policy decision engine: `evaluate(call, policy, context)` answers `allow`, `deny` or
 * `needs_approval` for one tool call and returns one record saying what it decided, why and which rule
 * decided. The policy format and its strict validation, policy loading, rule matching, a worked
 * example policy, the approval checkpoint, the append-only audit log and a worked mapping from an
 * adopting application's own shapes into Shield's are exposed beside it.
 *
 * The package is free, standalone and requires no signup, and it has no runtime dependency: nothing
 * here reads an environment variable, a configuration file or a secret, and the only import outside
 * this package inside it is the Node built-in `node:fs` that the audit file sink writes through.
 *
 * A conventional policy engine answers allow or deny. The third value, `needs_approval`, and the
 * approval checkpoint behind it are this package's own documented addition rather than a standard
 * result. `docs/shield/README.md` and `docs/shield/POLICY-FORMAT.md` carry the adopter-facing
 * description, and the supported threat model and the exclusions are stated in
 * `docs/shield/THREAT-MODEL.md` and `docs/shield/EXCLUSIONS.md`.
 */

// the decision engine
export { evaluate } from "./evaluate";
export type { DecisionRecord, EvaluateContext, ToolCall } from "./evaluate";

// the policy format and its strict validation
export { validatePolicy, readPolicyVersion } from "./policy/policy-schema";
export type { Decision, Policy, PolicyRule, PolicyValidationResult } from "./policy/policy-schema";

// policy loading
export { loadPolicy } from "./policy/load-policy";
export type { PolicyLoadResult } from "./policy/load-policy";

// rule matching
export { matchRule, ruleMatches } from "./policy/match-rule";
export type { RuleMatchTarget } from "./policy/match-rule";

// the worked example policy
export { examplePolicy } from "./policy/example-policy";

// the approval checkpoint
export { createApprovalStore } from "./approvals";
export type { ApprovalRecord, ApprovalStore } from "./approvals";

// the append-only audit log
export { createFileAuditSink, createInMemoryAuditLog } from "./audit";
export type { AuditEvent, AuditSink, InMemoryAuditLog } from "./audit";

// the reference adapter
export { toPolicy, toToolCall } from "./adapters/reference-adapter";
export type { GenericPolicy, GenericPolicyRule, GenericToolCall } from "./adapters/reference-adapter";
