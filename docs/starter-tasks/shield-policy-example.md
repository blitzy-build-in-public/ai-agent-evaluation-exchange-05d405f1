# Add a Shield policy example with unit tests

Labels: P1, good-first-issue, milestone M4

## Scope

ADEM Shield Basic answers one question per tool call — `allow`, `deny` or `needs_approval` — from a
policy it reads as data, so the fastest way to make it useful to an adopter is a worked example that
covers a situation the shipped one does not. Your task is to extend the shipped worked example and the
test beside it, so a reader sees the format in use and an adopter has something to copy.

**The format you are writing to.** A policy is `{ version: string; rules: PolicyRule[] }` and each rule
is `{ id, tool, decision: "allow" | "deny" | "needs_approval", reason, arguments? }` — the shapes
`packages/shield/src/policy/policy-schema.ts` declares and `docs/shield/POLICY-FORMAT.md` specifies for
adopters. Take the worked policy in `packages/shield/src/policy/example-policy.ts` as your shape, and
read `docs/shield/POLICY-FORMAT.md` for the full field reference, the matching semantics and how the
three outcomes are chosen, rather than re-deriving them here.

**Where your example goes, and why this is the awkward part.** Shield is a separate, free, standalone
package with no dependency on any other workspace and no runtime dependency at all, and its file set is
closed: no thirteenth file under `packages/shield/src`, no `policy/index.ts`, no `policy/types.ts`, no
constants module, and no per-package test-runner configuration — the one root unit configuration
discovers every `<name>.test.ts` beside its source by path, so a new test needs no registration and a
second runner would be a place to keep in step for nothing. Contribute by extending the worked example
and its beside-source test: add your rules to `packages/shield/src/policy/example-policy.ts` and your
assertions to `packages/shield/src/policy/example-policy.test.ts`, keeping the assertions that already
guard the example true of your rules too: every rule reachable from a call built out of its own
declared fields, no rule allowing the whole tool wildcard, one plausible tool name left unnamed, and no
rule borrowing a reason string the engine authors. If you are adopting Shield from your own application
outside this repository, keep your policy in your own project and mirror the format from
`docs/shield/POLICY-FORMAT.md`; that is the case the package exists for.

**The semantics your example must demonstrate.**

- **Tool matching**: a rule names one tool exactly, or `"*"` to match any tool.
- **Argument matching**: a rule's `arguments` map is compared against the call's arguments, where a
  declared `"*"` matches any value the call carries at that key.
- **Order**: rules are walked in the order declared and the first match decides — a later rule never
  overrides an earlier one, so the narrowest and highest-risk rules come first.
- **All three outcomes reachable**: at least one `allow`, one `deny` and one `needs_approval` rule.
- **Default deny**: leave at least one plausible tool name unmatched, so `evaluate` answers `deny` with
  reason `no_matching_rule`. Never add a catch-all allow rule — `tool: "*"` with `decision: "allow"` —
  because it makes default deny unreachable, and it is the defect the format exists to prevent.

**What you must not touch.** The fixed decision contract in `packages/shield/src/evaluate.ts`:
`evaluate(call, policy, context)` returns `{ decision: "allow" | "deny" | "needs_approval", reason,
ruleId }`, denying by default when no rule matches and answering `deny` with reason `malformed` for a
call missing its tool name or arguments or a policy that fails validation, and it never throws. The
engine's closed reason strings `no_matching_rule`, `malformed` and `approved`; the validation rules in
`packages/shield/src/policy/policy-schema.ts`; the approval keying in
`packages/shield/src/approvals.ts`; and the export surface of `packages/shield/src/index.ts`, the
package's only public entry, all stay as they are. Add no dependency either: the package declares none,
and one would need an inventory entry giving its exact version, licence and purpose first.

**Your example is data, never code.** No `eval`, no `new Function`, no dynamic import, no network call,
no `process.env` read and no `console` output: a rule is a value the engine inspects, and nothing here
executes. Keep it deterministic — assert with a fixed timestamp supplied through `context.now`, so the
audit event's `timestamp` is a literal rather than a clock read, and nothing depends on the clock, a
locale, a timezone or a random source. Keep it fictional — no real service, host, brand, account,
personal name, contact detail, credential or token, with the shipped example's made-up read, write and
message trio as the register to follow — and no `@` in any string and no run of five or more
consecutive digits, because the exclusion scan reads every tracked file and the manual privacy review
reads this folder. Nothing you write may present Shield as a gate pass, a certification, a safety
guarantee or an isolation mechanism: a policy is a decision about a call, and a written rule does not
create technical isolation.

Read next: `docs/shield/POLICY-FORMAT.md` for the format, its matching semantics and its validation
failures; `docs/shield/README.md` for the decision contract and the adopter's view;
`docs/shield/EXCLUSIONS.md` for what Shield does not do; `CONTRIBUTING.md` for the contribution path
and the pull-request checklist; `docs/ROADMAP.md` for the milestone and priority tier this belongs to.

## Acceptance

1. `npx tsc -b packages/shield/tsconfig.json` exits 0.
2. `npm run test:unit -- packages/shield` exits 0 with your assertions included, and they assert rather
   than describe: your allow rule allows and the decision record's `ruleId` is that rule's `id`; your
   deny rule denies; your `needs_approval` rule blocks the call until
   `createApprovalStore().recordApproval` records an approval for that call id, after which the same
   call answers `allow` with reason `approved`; a tool no rule names answers `deny` with reason
   `no_matching_rule`; and a call missing its tool name or its arguments, or a policy that fails
   validation, answers `deny` with reason `malformed` while raising nothing.
3. Your example is valid by itself: `validatePolicy(yourPolicy).ok === true`, every rule `id` is unique
   and non-empty, and at least one plausible tool name is left unmatched, so `matchRule` answers `null`
   for a call against it.
4. One decision, one audit event: with a `createInMemoryAuditLog()` supplied through `context.audit`,
   each decision appends exactly one event carrying the five fields `timestamp`, `callId`, `decision`,
   `ruleId` and `policyVersion`, and the `timestamp` is the literal you supplied through `context.now`.
5. The closed set is intact: `git diff --stat -- packages/shield/src/evaluate.ts
   packages/shield/src/index.ts` prints nothing, and `ls packages/shield/src packages/shield/src/policy`
   shows no file added — your change extends the worked example and the test beside it rather than
   adding a module, and no per-package runner configuration exists.
6. `npm run scan:exclusions` exits 0 with an empty finding list, and no string you added contains
   `@` or a run of five or more consecutive digits.
