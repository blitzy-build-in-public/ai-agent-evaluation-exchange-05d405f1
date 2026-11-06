# ADEM Shield Basic policy format

A policy is a JSON document stating, as data, what an in-process engine should answer for a tool
call: `allow`, `deny` or `needs_approval`. The engine reads the document and compares it against the
call it is handed. Nothing in a policy is executed, and a policy is a statement an engine inspects —
a written rule does not create technical isolation and enforces nothing by itself.

This document describes the format exactly as `packages/shield/src/policy/` implements it. Where a
sentence here and a module disagree, the module is authoritative and this document is the thing to
fix.

## The package's modules and the members they own

The package's public entry is `packages/shield/src/index.ts`, and it is the only path an adopting
application imports. The table maps every module of the package to the members it owns; the `In the
package entry` column says which of those members the entry re-exports and which stay inside the
package.

| Module | The members it owns | In the package entry |
| --- | --- | --- |
| `packages/shield/src/evaluate.ts` | `evaluate`, `DecisionRecord`, `EvaluateContext`, `ToolCall` | all |
| `packages/shield/src/policy/policy-schema.ts` | `Decision`, `PolicyRule`, `Policy`, `PolicyValidationResult`, `validatePolicy`, `readPolicyVersion` | all |
| `packages/shield/src/policy/load-policy.ts` | `loadPolicy`, `parsePolicyJson`, `PolicyLoadResult` | `loadPolicy` and `PolicyLoadResult`; `parsePolicyJson` is not re-exported |
| `packages/shield/src/policy/match-rule.ts` | `RuleMatchTarget`, `ruleMatches`, `matchRule` | all |
| `packages/shield/src/policy/example-policy.ts` | `examplePolicy` | all |
| `packages/shield/src/approvals.ts` | `createApprovalStore`, `ApprovalRecord`, `ApprovalStore` | all |
| `packages/shield/src/audit.ts` | `createFileAuditSink`, `createInMemoryAuditLog`, `AuditEvent`, `AuditSink`, `InMemoryAuditLog` | all |
| `packages/shield/src/adapters/reference-adapter.ts` | `toPolicy`, `toToolCall`, `GenericPolicy`, `GenericPolicyRule`, `GenericToolCall` | all |

A decision is made by `evaluate`, which reads the policy through `validatePolicy` and the matching
rule through `matchRule`. The audit event a decision appends is the `AuditEvent` shape
`packages/shield/src/audit.ts` defines, and the reference adapter is the worked example of mapping an
adopting application's own call and rule set onto the `ToolCall` and `Policy` shapes above.

## The document shape

```ts
export type Decision = "allow" | "deny" | "needs_approval";

export interface PolicyRule {
  id: string;
  tool: string;                                              // a tool name, or "*" to match any tool
  decision: Decision;
  reason: string;
  arguments?: Record<string, string | number | boolean | "*">;
}

export interface Policy { version: string; rules: PolicyRule[] }
```

A policy carries a `version` label and an ordered `rules` array. The same document in JSON form:

```json
{
  "version": "team-baseline-1.0.0",
  "rules": [
    {
      "id": "deny-high-risk",
      "tool": "*",
      "decision": "deny",
      "reason": "A call marked high risk is refused before any later rule is read.",
      "arguments": { "risk": "high" }
    },
    {
      "id": "allow-read-file",
      "tool": "read_file",
      "decision": "allow",
      "reason": "Reading a file inside the workspace is permitted.",
      "arguments": { "scope": "workspace" }
    },
    {
      "id": "approve-http-request",
      "tool": "http_request",
      "decision": "needs_approval",
      "reason": "An outbound request waits for an approval recorded for the call.",
      "arguments": { "destination": "*" }
    },
    {
      "id": "deny-delete-record",
      "tool": "delete_record",
      "decision": "deny",
      "reason": "Deleting a record is refused."
    }
  ]
}
```

Four calls against that document, written so the reader can check each one against it. A call to
`read_file` with the arguments `{ "scope": "workspace" }` matches `allow-read-file` — the first rule
does not match it, because the call carries no `risk` — and is decided `allow`, carrying that rule's
own reason text and `allow-read-file` as its rule id. A call to `http_request` with any `destination`
the call carries matches `approve-http-request`, whose expected value `"*"` accepts any present
value, and is decided `needs_approval`: the call is blocked until an approval is recorded for that
call's id. A call to `delete_record` matches `deny-delete-record`, which lists no arguments and is
therefore decided by its tool alone, and is refused with that rule's reason and its id. A call to
`write_file` matches nothing, because no rule names that tool, and is refused as `deny` with reason
`"no_matching_rule"` and no rule id — the engine's default deny, described in
[How the three outcomes are chosen](#how-the-three-outcomes-are-chosen).

## Field reference

| Field | Where | Required | Accepted values | Meaning |
| --- | --- | --- | --- | --- |
| `version` | document | yes | a non-empty string | The policy's revision label. It reaches the audit record as `policyVersion`. |
| `rules` | document | yes | an array of rule objects; an empty array is valid | Tried in declaration order; the first rule that matches decides. |
| `id` | rule | yes | a non-empty string, unique within the document | The rule's name. It appears in a decision record as the rule id when this rule decides. |
| `tool` | rule | yes | a non-empty string: a tool name, or `"*"` | The tool the rule is written for. `"*"` matches any tool. |
| `decision` | rule | yes | `allow`, `deny` or `needs_approval` | What the engine answers when the rule matches. |
| `reason` | rule | yes | a non-empty string, free text | The policy author's own explanation, copied verbatim into a decision this rule makes. |
| `arguments` | rule | no | an object | Argument constraints. Absent, the rule is decided by its tool alone. |
| an `arguments` key | rule | — | a non-empty string other than the reserved `__proto__` | The name of a call argument the rule constrains. |
| an `arguments` value | rule | — | a string, a finite number, a boolean, or `"*"` | What the call must carry at that key; `"*"` accepts any value the call carries there. |

No other key is accepted at either level: `version` and `rules` at the document level, and `id`,
`tool`, `decision`, `reason` and `arguments` on a rule. An unrecognised key is a validation failure
(see [Validation rules and what counts as a failure](#validation-rules-and-what-counts-as-a-failure)).

## How rules match

A rule is compared against a call by `ruleMatches`, and a policy's rules are walked in order by
`matchRule`, which answers with the first rule that applies or with nothing at all. `RuleMatchTarget`
is the shape a rule is matched against: the call's tool name and the arguments that call carries,
both required, with an empty record passed for a call that carries no arguments.

A rule matches a call only when both of these hold:

- the rule's `tool` equals the call's tool name, or the rule's `tool` is `"*"`; and
- every key listed in the rule's `arguments` equals the call's argument at that key.

The argument half of that test, in the cases an author meets:

- A rule with no `arguments` member is decided by its tool alone. A rule whose `arguments` is an
  empty object is the same case, and every argument the call carries beyond the rule's own keys is
  ignored.
- A key listed in `arguments` that the call does not carry does not match. Presence is own-key
  presence, so a rule naming `toString` or `constructor` counts only when the call itself carries it.
- An expected value of `"*"` accepts any value the call carries at that key, a nested object and
  `null` included. It does not match a key the call does not carry, because there is no value there
  to accept.
- Every other expected value must equal the call's value strictly, so a declared `1` never matches a
  call value of `"1"`, and a declared string, number or boolean never equals a call value of `null`,
  `undefined`, an object or an array.

Two strictness settings in `tsconfig.base.json` shape what an author can rely on here.
`exactOptionalPropertyTypes` is on, so a rule's `arguments` is either present or absent and is never
set to an explicit `undefined`: a rule that constrains nothing omits the member, and JSON has no way
to write `undefined` in any case. `noUncheckedIndexedAccess` is on, so a value read at an argument
key is treated as possibly absent until the call has been checked for that key — which is exactly
the rule above: a key the call does not carry cannot match.

Order is the whole of precedence. Rules are walked from the first, the first match is the answer,
and no later rule is consulted for a better or a more specific one — so a later rule never overrides
an earlier one. Order the rules with that in mind: put the narrowest and the highest-risk rules
first, so a rule written for one tool or one argument value is not pre-empted by a broader rule
declared above it. A rule whose `arguments` member is present but is not a usable record does not
match, whatever else the rule holds: the refusal does not wait for the member to list a constrained
key, because an unreadable member lists none, and accepting it would drop constraints the author
wrote and apply the rule to calls it was never written for. The call's side of the same test is
deliberately narrower: a rule that does list at least one constrained key does not match a call whose
own `arguments` member is not a usable record either, while a rule that lists none is decided by its
tool alone and never reads the call's `arguments` at all — so a call carrying an unusable `arguments`
member still matches an unconstrained rule.

## How the three outcomes are chosen

Every call reaches exactly one of these outcomes, and the mapping is total:

- **A matching rule whose `decision` is `allow`** gives `allow`, with that rule's `reason` and that
  rule's `id` as the rule id.
- **A matching rule whose `decision` is `deny`** gives `deny`, with that rule's `reason` and that
  rule's `id` as the rule id.
- **A matching rule whose `decision` is `needs_approval`** gives `needs_approval`, with that rule's
  `reason` and that rule's `id` as the rule id, and it blocks the call: the call is released only
  when a recorded approval exists for that call's id, and it is then `allow` with reason `"approved"`
  and the same rule id. Without an approval store, or with one that answers no or cannot answer, the
  call stays blocked — the absence of an approval is not an approval. This third value is this
  engine's own documented extension of a conventional allow-or-deny engine, not a standard result,
  and nothing here should be read as a standard one. How an approval is recorded, and what keying it
  by call id alone does and does not cover, is in `docs/shield/THREAT-MODEL.md`.
- **No rule matches** gives `deny` with reason `"no_matching_rule"` and no rule id. This is the
  engine's default deny, and it is the reason no catch-all allow rule belongs in a policy: a rule
  with `tool: "*"` and `decision: "allow"` would make default deny unreachable and make every
  unmatched call an allow.
- **A call the engine cannot read** — one missing its id, its tool name or its arguments — or a
  policy that fails validation gives `deny` with reason `"malformed"` and no rule id. The engine
  never throws: a value it cannot read comes back as a refusal rather than as an exception, and no
  branch of it returns `allow` from a value it could not read.

## How reason and ruleId are produced

A decision carries the reason and the rule id of whatever produced it, and the two sources are
distinguishable on sight:

- **A decision made by a rule** carries that rule's own `reason` text, copied verbatim, and that
  rule's `id` as the rule id. A rule's `reason` is free text its author writes; it is carried through
  unchanged and never rewritten.
- **A decision made by the engine** carries one of the engine's own closed reason strings —
  `"no_matching_rule"`, `"malformed"` or `"approved"` — which are authored in
  `packages/shield/src/evaluate.ts` and are not policy-authored values. A policy author should never
  write one of them as a rule's `reason`: the engine's own refusals would then be indistinguishable
  from a rule's decision. The rule id is absent (`null`) whenever no rule decided, which is the case
  for `"no_matching_rule"` and `"malformed"`; `"approved"` carries the id of the rule that blocked
  the call, because that rule produced the outcome the approval released.

## How the policy version reaches the audit record

The policy's `version` is read by `readPolicyVersion` and recorded as `AuditEvent.policyVersion`, so
a recorded decision names the policy revision it was made under. The audit event carries five fields
and no more: `timestamp`, `callId`, `decision`, `ruleId`, `policyVersion`. How those events are
stored and read back belongs to `docs/shield/README.md`.

`readPolicyVersion` returns the candidate's own `version` when it is a non-empty string and `""`
otherwise — the empty answer covers a candidate that is not an object and one whose version is
missing, not a string or empty, including a document that failed validation for another reason. That
is the point of it: an audit line can still name the policy whose rules were refused. An audit line
can therefore carry an empty `policyVersion`, and that is the designed behaviour rather than a
defect. It is deliberately not a second validator — it never reads `rules`, never reports an error and
never throws — so a non-empty answer from it is not an approval of the document. `validatePolicy` is
the only thing that accepts a policy.

## Validation rules and what counts as a failure

`validatePolicy(candidate: unknown)` returns `PolicyValidationResult`: `{ ok: true; policy }` when
the candidate is a policy, and `{ ok: false; error }` otherwise. On success the `policy` is a
freshly built copy holding exactly the validated fields, so a later mutation of the caller's own
object cannot change a policy that has already been validated; a rule carries an `arguments` member
only when it supplied one. The format is hand-written and closed: it is not JSON Schema, validation
is this code rather than a schema library, and the package has no dependencies.

Each of these is a failure, and none of them is ever silently ignored:

- a candidate, a rule or an `arguments` record that is not a non-null, non-array object whose own
  enumerable string keys carry the whole of it — which refuses `null`, a primitive, a function and an
  array, and also a container whose members live outside its string keys, such as a `Map`, a `Set` or
  a `Date`, because read as a record it would look empty;
- an unrecognised key at the document level or at the rule level;
- a `version` that is missing, not a string or empty;
- `rules` that is missing or not an array — an empty array is valid, because refusing to name any
  rule can only deny more;
- a rule entry that is not a non-null, non-array object;
- a rule `id`, `tool` or `reason` that is missing, not a string or empty;
- a `decision` outside `allow`, `deny` and `needs_approval`;
- a rule id already used earlier in the same policy;
- an `arguments` record that is not such an object, that holds an empty key, that holds the reserved
  key `__proto__` — a name a validated record cannot carry as its own member, so keeping it would
  drop the author's constraint — or that holds a value which is neither a string, a finite number, a
  boolean nor `"*"`.

The error is a short, lower-case message naming the place to fix, and no message carries a value
taken from the candidate. Validation happens at load time, and the engine performs the same
validation at decision time, so a policy that never passed through the loader is refused rather than
trusted. Neither `validatePolicy`, `loadPolicy` nor `parsePolicyJson` throws for any input.

## Loading a policy

`loadPolicy(input: unknown)` accepts the policy in either form a caller may hold it in: an
already-parsed value, or the JSON text it was read from — a configuration file the host application
parsed itself, or a string it read from its own configuration. A string is the only input read as
JSON text; every other value, `null`, `undefined`, a number, a boolean, a function and a cyclic
object included, is validated exactly as it stands without being serialised first. `parsePolicyJson`
is the string-only entry point `packages/shield/src/policy/load-policy.ts` exports, and `loadPolicy`
delegates a string input to it; an adopter holding only the package entry reaches the JSON-text case
through `loadPolicy`, and the two return the same result shape, `PolicyLoadResult`:
`{ ok: true; policy }` when the input is a policy, and `{ ok: false; error }` otherwise.

`JSON.parse` is the sole parser, and text that is not valid JSON is a refusal — including text that
parses to something other than a policy, such as a JSON array or a JSON scalar. A `text` argument
that is not a string at all is refused rather than passed on to `JSON.parse`. Every message is short
and free of the input it came from, because a policy text may hold a credential-shaped value or be
very long, and an error echoing it would both spread it and be disproportionately large.

Neither function throws for any input. An input that cannot be read as a policy is refused rather
than accepted: `null`, an array, a cyclic object, unparseable text such as `"{"`, an empty string, a
JSON array and a JSON scalar all come back as `{ ok: false, error }`. So does an object carrying its
members through symbol keys alone, because a policy is read from own enumerable string keys — such a
document has no `version` and no `rules`, and is refused rather than read as empty.

## The worked example policy

`examplePolicy` in `packages/shield/src/policy/example-policy.ts` is the worked example the Shield
tests use as their fixture and the shape to copy. Its own JSON form:

```json
{
  "version": "example-1.0.0",
  "rules": [
    {
      "id": "deny-high-risk-call",
      "tool": "*",
      "decision": "deny",
      "reason": "A call marked high risk is refused before any later rule can match it.",
      "arguments": { "risk": "high" }
    },
    {
      "id": "allow-read-file",
      "tool": "read_file",
      "decision": "allow",
      "reason": "Reading a file inside the workspace is permitted by this example policy.",
      "arguments": { "scope": "workspace" }
    },
    {
      "id": "approve-write-file",
      "tool": "write_file",
      "decision": "needs_approval",
      "reason": "Writing a file inside the workspace waits for an approval event for the call.",
      "arguments": { "scope": "workspace", "target": "*" }
    },
    {
      "id": "allow-send-message",
      "tool": "send_message",
      "decision": "allow",
      "reason": "Sending a message on the demo channel at normal priority is permitted here.",
      "arguments": { "channel": "demo-channel", "priority": 1, "urgent": false }
    },
    {
      "id": "deny-delete-record",
      "tool": "delete_record",
      "decision": "deny",
      "reason": "Deleting a record is refused by this example policy."
    }
  ]
}
```

It exercises all three outcomes — `allow` (`allow-read-file`, `allow-send-message`), `deny`
(`deny-high-risk-call`, `deny-delete-record`) and `needs_approval` (`approve-write-file`) — both
positions of the wildcard `"*"`, as a rule's `tool` and as an expected argument value, and argument
matching against a string, a number and a boolean.

- The wildcard rule comes first on purpose: rules are read in order and the first match decides, so a
  wildcard placed last would let an earlier `allow` rule answer a call the author meant to refuse.
  Ordering the highest-risk rule first is the authoring guidance above, applied.
- `approve-write-file` constrains `arguments` as well as its tool, which is how an author narrows a
  call rather than relying on the approval checkpoint to disambiguate it; the checkpoint itself keys
  approvals by call id alone, and `docs/shield/THREAT-MODEL.md` states what that does and does not
  cover. Both of its keys must be present on the call: `write_file` with
  `{ "scope": "workspace", "target": "notes.txt" }` is decided `needs_approval`, while the same call
  with `target` left out matches no rule at all and reaches the default deny — the `"*"` expected
  value accepts any value the call carries at that key, and cannot accept a key that is not there.
- No rule names `http_request`, so a call to it that does not carry `risk: "high"` matches nothing
  and reaches the engine's default deny: `deny` with reason `"no_matching_rule"` and no rule id. The
  unmatched tool is left out deliberately, so default deny is demonstrated rather than assumed.
- There is no catch-all allow rule. The only rule whose `tool` is `"*"` denies, because a rule
  allowing every tool would leave default deny unreachable.

The file itself holds no logic: it is data, it is not validated at import time, and validating it is
the loader's job.

## Fail-closed by design

- **Data, never code.** A policy document is parsed and inspected as data: no `eval`, no
  `new Function`, no dynamic `import()` and no network call. Writing a policy is therefore never a way
  to run code inside the adopting process — and, for the same reason, a rule is never a technical
  isolation mechanism. Shield decides about the call it is handed; an `allow` is a statement about
  that call under that policy, not a boundary and not a guarantee about the system that runs it.
- **An undecidable input is a refusal.** Nothing makes a policy valid by ignoring a problem. A
  validator that answered `ok: true` because it could not read something would be the same defect as
  a permissive default, so a value that cannot be read is refused at load time and refused again at
  decision time rather than accepted.
- **No permissive default.** A call no rule matches is denied, so a policy that omits a rule narrows
  what the engine allows rather than widening it. An unreadable call and an invalid policy are both
  denied, and the engine never throws.
- **Refusing beats matching.** A rule whose `arguments` cannot be read, or that names a key the call
  does not carry, does not match. A rule that lists constrained keys is not met by a call whose own
  `arguments` member cannot be read either, while a rule that lists none is decided by its tool alone.
  Dropping a constraint and matching anyway would apply the rule to calls its author never wrote it
  for.
- **A checkpoint can only release, never widen.** An approval releases a call a rule blocked with
  `needs_approval`; it cannot turn a `deny` into an `allow` and cannot add a rule to a policy.

A Shield decision is not an evaluation outcome: it is one of `allow`, `deny` and `needs_approval`,
and it is never one of the report labels `SAMPLE` or `VERIFIED-IN-DEMO`.

What a policy cannot do — what Shield does not cover, and what it must therefore not be taken to
claim — is listed in `docs/shield/EXCLUSIONS.md`.

## Read next

- `docs/shield/README.md` — how Shield is used, the three-field decision contract and the audit
  record.
- `docs/shield/THREAT-MODEL.md` — the supported threat model, and the limits of keying approvals by
  call id alone.
- `docs/shield/EXCLUSIONS.md` — what Shield does not cover.
- `packages/shield/src/index.ts` — the package's public entry, and the whole surface an adopting
  application imports.
- `packages/shield/src/policy/` — the implementation of every rule stated here.

