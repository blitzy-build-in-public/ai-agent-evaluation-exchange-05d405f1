# ADEM Shield Basic

ADEM Shield Basic is a small, free, standalone policy decision engine that an application embeds to
get an explicit, default-deny decision about one tool call, a checkpoint that holds a call until a
human approval has been recorded, and an audit record for every decision. It is one of this
repository's independently adoptable packages, unrelated to the commercial surfaces and to the
evaluation standard. Its only public entry is `packages/shield/src/index.ts`.

## What ADEM Shield Basic is

- **Free, and no signup of any kind.** There is no registration, no licence key, no account and no
  telemetry. The package reads no environment variable, no configuration file and no secret, and it
  makes no network call.
- **Standalone and dependency-free, structurally.** `packages/shield/package.json` declares no
  runtime `dependencies` and no `peerDependencies`, and no `scripts`; its one declared dependency is
  the development-time `typescript` pin it is built with, which never reaches a runtime.
  `packages/shield/tsconfig.json` declares no `references` and no `paths`, so no build edge exists
  from this package to any sibling workspace. The only import a non-test module of the package makes
  is the Node built-in `node:fs` in `packages/shield/src/audit.ts`. These are facts about the source
  tree, not promises about it.
- **One public entry.** `packages/shield/src/index.ts` is the package's only public entry, reached
  through the package's `exports` map: import from `@adem/shield` and reach no other file.
- **How an adopter gets it.** It is not published to a registry and it is not a product. The
  workspace is marked `"private": true` and carries no publish configuration, so adoption means
  consuming it from a checkout of this repository, or vendoring `packages/shield/` into your own
  project under the repository's MIT licence (`LICENSE`). No registry install command is documented
  here, because none would work.
- **What it is part of.** `packages/shield/` is one of this repository's workspaces (the root
  `package.json` declares `packages/*`), and it is a `.github/CODEOWNERS`-protected path. It is not
  wired into the product: `apps/api` does not import it, no ADEM route is protected by it, and no
  Shield decision appears in the product's data. Policy enforcement is Shield's own adoptable
  surface.

## The decision contract

One call, one policy, one record. The signature is `evaluate(call, policy, context)`, where `call` is
a `ToolCall` holding the call's `id`, its `tool` name and its `arguments`, `policy` is a `Policy`
holding a `version` and a list of rules, and `context` is optional. The record it returns is exactly
this shape, and it is fixed — it may not be widened, narrowed or renamed:

```ts
{ decision: "allow" | "deny" | "needs_approval", reason, ruleId }
```

`reason` carries the text that explains the outcome, and `ruleId` is the id of the rule that decided
or `null` when no rule decided. Rules are walked in the author's order and the first match decides,
so exactly one rule can produce a record; `packages/shield/src/evaluate.ts` is the one place the
record is built.

Every call reaches exactly one of the three outcomes:

- **`allow`** — a rule in the supplied policy matched the call and that rule's `decision` is `allow`.
  The record carries that rule's own `reason` text and that rule's `id` as `ruleId`.
- **`deny`** — either a matched rule's `decision` is `deny` (carrying that rule's `reason` and its
  `id`), or no rule matched at all, in which case the reason is the engine's own `"no_matching_rule"`
  and `ruleId` is `null`. `"no_matching_rule"` is the default deny: the absence of a rule is a
  refusal, which is why no catch-all allow rule belongs in a policy.
- **`needs_approval`** — a matched rule's `decision` is `needs_approval`. The call is blocked until a
  recorded approval exists for that call id, at which point the decision becomes `allow` with reason
  `"approved"` and the blocking rule's id. Without such an approval, the call stays blocked.

**A malformed input never throws.** A call missing its tool name or its arguments, or a policy that
fails schema validation, returns `deny` with reason `"malformed"` and `ruleId: null`. The engine does
not raise, and no code path returns `allow` from a value it could not read: an undecidable input is a
refusal. Because `evaluate` accepts `unknown` for both the call and the policy, a caller needs no
cast — and a policy that never passed through `loadPolicy` is still validated at decision time and
refused rather than trusted.

**The engine's own reason strings are closed**, and they are authored by the engine rather than by a
policy: `"no_matching_rule"`, `"malformed"` and `"approved"`. A decision made by a rule carries the
rule author's `reason` text verbatim instead, so the two sources are distinguishable on sight.

**`needs_approval` is this package's extension.** A conventional policy engine has two outcomes, and
this third value — with the approval checkpoint behind it — is this package's own documented addition,
not a standard result, and it should not be read as one.

A whole decision, end to end:

```ts
import { evaluate, type Policy } from "@adem/shield";

const policy: Policy = {
  version: "example-1.0.0",
  rules: [
    { id: "allow-read-file", tool: "read_file", decision: "allow", reason: "Reading a file is permitted by this policy." },
  ],
};
const context = { now: () => "2025-01-01T00:00:00.000Z" };

const permitted = evaluate({ id: "call-1", tool: "read_file", arguments: { path: "notes.txt" } }, policy, context);
const unmatched = evaluate({ id: "call-2", tool: "http_request", arguments: { destination: "demo-endpoint" } }, policy, context);

console.log(permitted);
console.log(unmatched);
```

```text
{ decision: 'allow', reason: 'Reading a file is permitted by this policy.', ruleId: 'allow-read-file' }
{ decision: 'deny', reason: 'no_matching_rule', ruleId: null }
```

No rule names `http_request`, so that call reaches the default deny. The fixed `now` supplier is what
keeps the example — and any audit trail it writes — reproducible; it never influences a decision.

## The approval checkpoint

`EvaluateContext.approvals` accepts an approval store created by `createApprovalStore()`, whose
members are `recordApproval(approval)`, `hasApproval(callId)`, `getApproval(callId)` and
`listApprovals()` (`packages/shield/src/approvals.ts`).

- An approval record is `{ callId, approvedBy, reason, at }`. The `at` instant is **supplied by the
  caller**, so a record and the audit trail around it stay deterministic; `approvedBy` and `reason`
  are opaque strings Shield does not verify and cannot vouch for.
- The store is keyed by **call id alone**, and it is append-only: the first approval recorded for an
  id wins, the stored record is frozen as it is recorded, and no update and no delete function exists
  anywhere in the package.
- When a `needs_approval` decision was reached and an approval for that call id exists, the decision
  becomes `allow` with reason `"approved"`.
- When no approval store is supplied, a `needs_approval` decision stays `needs_approval`. The
  checkpoint narrows nothing and never widens: it can release a call a rule blocked, and it can never
  turn a `deny` into an `allow` or add a rule to a policy.

Because approvals are keyed by call id alone, Shield cannot tell whether the call being evaluated is
the call a human approved. Give every call a unique id, and show the call itself to the approver. The
limitation and its residual risk are in `docs/shield/THREAT-MODEL.md`, and it is listed among the
obligations an adopter carries in `docs/shield/EXCLUSIONS.md`.

## The audit log

Every decision appends **exactly one audit event**, and the event has **exactly five fields and no
others**: `timestamp`, `callId`, `decision`, `ruleId`, `policyVersion`
(`packages/shield/src/audit.ts`). The code and these documents describe the same record.

- `policyVersion` is the supplied policy's `version`, read by `readPolicyVersion`. It is the empty
  string when the policy failed validation and therefore has no readable version — which is designed
  behaviour, not a defect: the line still names the policy whose rules were refused.
- Two sinks are supplied through `EvaluateContext.audit`, both created by factories: an in-memory log
  (`createInMemoryAuditLog()`, read back in process) and a file sink
  (`createFileAuditSink(filePath)`) that writes one newline-delimited JSON line per event in append
  mode, rewriting nothing, and creates the parent directory on the first append so a path mistake
  surfaces as a write failure rather than a silent one.
- Neither sink offers a delete or an update — the sink contract is one method, `append` — and entries
  are appended, never rewritten. Nothing has to be flushed or closed for an event to reach its
  destination.
- With no sink in the context, nothing is recorded at all.
- Persistence and durability are the **caller's** beyond the append Shield performs. Because
  `evaluate` promises never to throw, a failing append cannot surface as an exception from the
  decision: it loses the record of a decision that has already been reached, and never changes that
  decision. A caller that requires the trail monitors the sink it supplied — the cost of the promise
  is stated as an obligation in `docs/shield/EXCLUSIONS.md`.

## Integrating Shield: the reference adapter

`packages/shield/src/adapters/reference-adapter.ts` is the worked adoption example: the few lines an
adopter writes for its own shapes, to be read and copied rather than depended on.

- `toToolCall` maps a generic tool call `{ callId, name, input }` onto `{ id, tool, arguments }`:
  `callId` becomes the call's `id`, `name` becomes its `tool`, and `input` is copied into its
  `arguments`.
- `toPolicy` maps a generic policy `{ version, rules: [{ id, name, effect, message, arguments? }] }`
  onto `{ version, rules: [{ id, tool, decision, reason, arguments? }] }`: `effect` maps `"allow"` to
  `"allow"`, `"deny"` to `"deny"` and `"ask"` to `"needs_approval"`; `name` becomes `tool`; `message`
  becomes `reason`; and `id`, `version` and `arguments` pass through unchanged. The host's rule order
  is preserved, because the first matching rule decides.
- Neither function validates, and neither throws. `evaluate` remains the single fail-closed
  checkpoint, so a mapped-but-invalid policy is refused there with reason `"malformed"` rather than
  allow-listed.
- The adapter is a mapping example, not an integration that makes a host application safe: it shows
  which fields correspond, and nothing more.

The target format's rules, its matching semantics and its validation failures are in
`docs/shield/POLICY-FORMAT.md`.

## What Shield is not

- **Not a gate pass, and not a security guarantee.** Nothing Shield returns may be presented as a
  pass, a certification, an audit result or a measure of safety.
- **Not a certification, and not independently verified.** It conforms to no framework, standard or
  regulation, and no audit or compliance coverage should be inferred from it.
- **Not a sandbox, and no isolation of untrusted code.** Shield contains nothing, spawns nothing and
  supervises nothing; it decides about a call the caller has already constructed and will itself
  perform.
- **Not a network mediator.** It neither observes nor blocks any connection. A policy that denies a
  tool named for a network operation denies a decision about a call, not a connection.
- **Not an enforcement point.** It returns a decision record and installs no interposition, hook or
  wrapper, so a caller that ignores the result is unaffected by it.
- **Not a durable store.** The audit trail has no persistence, retention, rotation or tamper-evidence
  guarantee beyond the caller-supplied sink.
- **Not a defence against a malicious policy author.** Strict validation refuses a malformed
  document, not a hostile one; a policy from a source you do not control is that source's meaning.
- **Not any part of the Standard Gate Index**, and it produces neither `SAMPLE` nor
  `VERIFIED-IN-DEMO`: those labels belong to evaluation reports, whose scope is "structured output on
  fixture set only", and they appear in no Shield output. Shield is equally outside the commercial
  path — nothing in it records an amount, an offer, a fee or a ledger entry, and no `DEMO` amount
  appears in it.
- **Not a source of technical isolation.** A written rule is a decision, not a boundary: saying a
  tool is denied changes nothing about what the process can do.

A policy is data an in-process engine inspects, and a decision is advice the caller must act on.

## Read next

- `docs/shield/POLICY-FORMAT.md` — the format an adopter writes, the matching semantics and the
  validation failures.
- `docs/shield/THREAT-MODEL.md` — the supported threat model and the residual risks.
- `docs/shield/EXCLUSIONS.md` — the exclusions list, and what an adopter must supply.
- `packages/shield/src/` — the implementation; `packages/shield/src/index.ts` is the whole surface an
  adopting application imports.
- `SECURITY.md` — how to report a suspected vulnerability.
- `CONTRIBUTING.md` with `.github/CODEOWNERS` — the review path: `packages/shield/` is a
  CODEOWNERS-protected path, so a change to Shield needs maintainer review.
