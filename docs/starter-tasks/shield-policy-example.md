# Add a Shield policy example with its tests

Labels: P1, good-first-issue, milestone M4

## Scope

ADEM Shield Basic is free, standalone and needs no signup, and the fastest way to make it useful to
an adopter is a worked policy for a situation its shipped example does not cover. Your task is to add
one policy example and the tests that pin its decisions, using only the package's public entry — no
deep import, no change to the engine.

You write two things and nothing else.

1. **Your policy**, a value satisfying `Policy` as `packages/shield/src/policy/policy-schema.ts`
   declares it, checked by `validatePolicy` before it is used and loadable through `loadPolicy`.
   Rules are matched by tool name and arguments; the engine denies by default, so **an action your
   policy does not mention is denied** and that is the property your example should demonstrate
   rather than avoid.
2. **Its tests**, beside it as `<name>.test.ts`, asserting the decisions the policy produces. Every
   decision is one record: `evaluate(call, policy, context)` answers `allow`, `deny` or
   `needs_approval` and returns `{ decision, reason, ruleId }`. Assert all three values if your policy
   uses them, and assert the record's `reason` and `ruleId` rather than only the verdict, because the
   record is what an operator reads when asking why a call was refused.

**The contract your example must show, not restate.** Default deny when no rule matches. A call
missing its tool name or its arguments, or a policy that fails schema validation, is answered
`deny` with reason `malformed` — never an exception, because a decision engine that throws on
malformed input hands the caller an error path instead of a decision. `needs_approval` blocks the
call until a recorded approval event exists for that call id, which is what
`createApprovalStore()` is for. Every decision appends one audit event to the log the caller supplies
— `createInMemoryAuditLog()`, or `createFileAuditSink()` for a newline-delimited file — carrying the
timestamp, the call id, the decision, the rule id and the policy version. A policy may decide
anything about a call; it may not decide anything about the system running it.

**What must not change, and what not to claim.** The engine
(`packages/shield/src/evaluate.ts`), the schema and the matcher stay as they are: an example that
needs an engine change is a finding for an issue, not a silent edit. Shield has **no dependency on
any other workspace and no runtime dependency at all**, so your example imports nothing outside the
package and the Node built-ins. And nothing in your example, its comments or its tests may present a
Shield decision as a gate pass, a certification, an audit result or a measure of safety: Shield's
supported threat model and its exclusions are stated in `docs/shield/THREAT-MODEL.md` and
`docs/shield/EXCLUSIONS.md`, and a policy is a decision about a call rather than a boundary around a
system.

Data in an example stays fictional: no real brand, company, product, personal name, contact detail,
credential, token, key or secret — no `@` in any string, no run of five or more consecutive digits,
and no value that could be mistaken for a live credential, because the exclusion scan reads every
tracked file and the manual privacy review reads this one.

Read next: `docs/shield/POLICY-FORMAT.md` for the format an adopted policy is written in;
`docs/shield/README.md` for the adopter's view; `packages/shield/src/policy/example-policy.ts` for
the shipped example and `packages/shield/src/policy/example-policy.test.ts` for how its decisions are
pinned; `packages/shield/src/audit.ts` and `packages/shield/src/approvals.ts`.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- packages/shield` exits 0 with your tests included, and they assert rather
   than describe: a call your policy allows answers `allow` with your rule's id; a call it does not
   mention answers `deny`, which is the default rather than a gap; a call needing approval answers
   `needs_approval` and the same call answers `allow` after its approval event is recorded.
3. The malformed paths are asserted: a call without a tool name or without arguments, and a policy
   that fails `validatePolicy`, each answer `deny` with reason `malformed` while raising nothing.
4. The audit trail is asserted: one decision produces exactly one appended event carrying the call
   id, the decision, the rule id and the policy version, and an event is appended even for the
   `malformed` denial.
5. `npm run test:unit -- packages/shield` exits 0 for the whole package, which is the check that your
   example did not need an engine change: no file under `packages/shield/src/evaluate.ts`,
   `packages/shield/src/policy/` or `packages/shield/src/audit.ts` other than your own example is in
   the diff — `git diff --stat -- packages/shield/src/evaluate.ts
   packages/shield/src/policy/match-rule.ts packages/shield/src/policy/policy-schema.ts` prints
   nothing.
6. `npm run scan:exclusions` exits 0 with an empty finding list, and no file you add holds an `@` or
   a run of five or more consecutive digits.
