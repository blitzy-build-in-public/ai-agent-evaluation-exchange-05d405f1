# Add a Shield adapter for a new call shape

Labels: P1, good-first-issue, milestone M4

## Scope

Every adopting application hands Shield its own idea of a tool call, and an adapter is the small,
honest translation between the two: the adopter keeps its own shapes, Shield keeps its own, and the
translation is where the mapping is written down and tested once rather than guessed at every call
site. The package ships one worked adapter; your task is a second, for a call shape the shipped one
does not cover, following the same discipline.

You write two things and nothing else.

1. **Your adapter**, beside the shipped one, exporting the two functions the pattern needs: one
   mapping the adopting application's call into Shield's `ToolCall`, and one mapping its policy into
   Shield's `Policy`. Keep the adopter's types declared in your module — Shield's public entry
   exports `toToolCall`, `toPolicy` and the `GenericToolCall`, `GenericPolicy` and
   `GenericPolicyRule` types the shipped adapter uses, and your version either reuses those or
   declares its own, but it never reaches into `packages/shield/src/` for a name the entry does not
   export.
2. **Its tests**, beside it, asserting the mapping rather than describing it: a call of the new shape
   maps to the tool name, arguments and call id Shield decides on; a policy of the new shape maps to
   rules whose names and argument matchers are identical after mapping; and a call the mapped policy
   does not cover is still denied, because the default belongs to the engine and an adapter must never
   widen it.

**The two properties an adapter must keep.** It maps and decides nothing: `evaluate` owns the
verdict, the default deny and the audit append, and an adapter that answers allow on its own, supplies
a default rule, or swallows a malformed input has moved a decision out of the place the record of it
is written. And it is total over its input: whatever the adopting application hands it — a missing
argument object, an unknown tool name, an extra field — the adapter must produce a call Shield
answers with `deny` or `deny`/`malformed` rather than raising, because Shield's promise is a decision
record for every call it is given.

**What must not change.** Shield has no dependency on any other workspace and no runtime dependency
at all, so your adapter imports nothing outside the package and the Node built-ins; the engine, the
schema and the matcher stay as they are; and your module does not become a second policy format. A
Shield decision is never presented as a gate pass, a certification, an audit result or a measure of
safety — `docs/shield/THREAT-MODEL.md` and `docs/shield/EXCLUSIONS.md` say what Shield does and does
not cover, and an adapter changes none of it.

Example data stays fictional: no real brand, company, product, personal name, contact detail,
credential, token or key, no `@` in any string and no run of five or more consecutive digits. A
credential-shaped value in an example is read by the exclusion scan as a credential, because it
cannot tell the difference and neither can a reader.

Read next: `packages/shield/src/adapters/reference-adapter.ts` and its test beside it, which is the
pattern you are following; `docs/shield/POLICY-FORMAT.md` and `docs/shield/README.md`;
`packages/shield/src/evaluate.ts` for `ToolCall`, `EvaluateContext` and `DecisionRecord`.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- packages/shield` exits 0 with your tests included, and they assert the
   mapping member by member: the tool name, the arguments and the call id survive the round trip, a
   rule's name and its argument matcher are identical after mapping, and the mapped policy's version
   is the one the adopter declared.
3. Totality is asserted, not assumed: a call with no argument object, a call naming a tool no rule
   covers, and a call carrying an unexpected field each produce a call the engine answers, and none of
   them throws out of the adapter.
4. The engine stays the decider: a mapped call answered by the mapped policy returns the engine's own
   record — a `decision`, a `reason` and a `ruleId` — and an appended audit event exists for it, which
   the same test reads back from the log the caller supplied.
5. Shield's isolation still holds in the diff: `git diff --stat -- packages/shield/package.json`
   prints nothing — no dependency was added — and `npm run test:unit -- packages/shield` passes for
   the whole package while no file under `packages/shield/src/evaluate.ts`,
   `packages/shield/src/policy/` or `packages/shield/src/audit.ts` is in your diff.
6. `npm run scan:exclusions` exits 0 with an empty finding list, and no file you add holds an `@` or a
   run of five or more consecutive digits.
