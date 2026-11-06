# ADEM Shield Basic threat model

This document states the threat model ADEM Shield Basic supports: what the package protects, where its trust boundaries are, what its design defends against and what it deliberately does not. Shield is a free, standalone, in-process policy decision engine — the adopting process calls `evaluate(call, policy, context)` and receives one decision record — so this model is written for an application that embeds the package rather than for an operator of a service.

## Scope of this model

In scope: Shield as a policy **decision point** inside an adopting process — the decision path in `packages/shield/src/evaluate.ts`, the policy document it reads through `packages/shield/src/policy/policy-schema.ts` and `packages/shield/src/policy/load-policy.ts`, the approval checkpoint in `packages/shield/src/approvals.ts`, and the audit trail in `packages/shield/src/audit.ts`.

Out of scope: the adopting application and everything around Shield — the process it runs in, the operating system, the network, the data store, and the tool call the caller goes on to perform; the ADEM repository's own surfaces and actors, whose model is `docs/THREAT-MODEL.md`; and the SGI evaluation path, whose standard is `docs/STANDARD-SGI-SO-1.0.0.md`.

Shield is a library, not a service. Nothing under `packages/shield/src/` listens, schedules, spawns or supervises anything: the adopting process calls Shield on its own thread with its own privileges and receives a value back. Shield is also outside the commercial path entirely — it has no import edge to or from `packages/commerce-sim`, records no amount, offer, fee or ledger entry, and no workspace of this repository runs it at all: `apps/api` does not call Shield, so no route of the ADEM API is protected by it.

## What Shield protects

1. **The fidelity of a decision.** An `allow` means a rule in the policy the caller supplied matched the call and said allow, and no other path through the engine can produce one.
2. **The completeness of the decision record.** Every call is answered with one record carrying `{ decision, reason, ruleId }`, the refusals included, so a caller that reads the record has seen everything the engine can say about that call.
3. **The integrity of the policy document as data.** A policy is parsed and inspected as data and never executed, so supplying a policy is never a way to run code in the adopting process.
4. **The audit trail's per-decision shape.** Every decision appended through a caller-supplied sink is one event carrying exactly five fields: `timestamp`, `callId`, `decision`, `ruleId`, `policyVersion`.

Shield protects nothing else. It also protects none of these four against an adopting process that ignores what it returns: an `allow` is a statement about the call under that policy, and enforcement is the caller's.

## Trust boundaries

**The adopting caller ↔ the engine, in process.** `evaluate(call, policy, context)` is an ordinary function call: no network hop, no IPC, no serializer, no separate authority and no privilege change, because both sides run in the caller's process as the caller. This is the whole boundary — Shield cannot be a boundary against the process that contains it.

**The policy document ↔ the engine.** A policy is untrusted data. It is parsed and validated as data (`packages/shield/src/policy/policy-schema.ts`, `packages/shield/src/policy/load-policy.ts`) and interpreted by `packages/shield/src/policy/match-rule.ts`. There is no `eval`, no `new Function`, no dynamic `import()` and no network call anywhere on that path. The honest limit: strict validation rejects a **malformed** document and does nothing at all about a **hostile** or merely unwise one — a valid policy can allow every tool it does not mention, and a broad rule declared above a narrow one decides before the narrow one is read.

**The engine ↔ the caller-supplied approval store and audit sink.** Both arrive through `EvaluateContext`, whose members `approvals`, `audit` and `now` are all optional and all supplied by the caller, so their trustworthiness, durability and monitoring are the caller's and not Shield's. An absent `approvals` store leaves a `needs_approval` decision exactly as it stands — fail closed, never widened — and an absent `audit` sink means the caller asked for no history, so nothing is appended.

## What the engine does defend, and how

- **Explicit rules only.** A decision that grants anything comes from a rule in the policy the engine was handed; there is no ambient permission, no built-in allow list and no tool the engine permits by default (`packages/shield/src/evaluate.ts`).
- **Default deny.** A call no rule matches is refused as `deny` with reason `no_matching_rule` and no rule id, so the absence of a rule is a refusal rather than a gap to reason about (`packages/shield/src/evaluate.ts`, `packages/shield/src/policy/match-rule.ts`).
- **Fail-closed handling of undecidable input.** A call missing its id, its tool name or its argument record, and a policy that fails schema validation, both yield `deny` with reason `malformed` and no rule id, and the engine never throws. Nothing in the package may answer `allow` because it could not parse something: a permissive default inside a `catch` is the defect this mechanism exists to prevent (`packages/shield/src/evaluate.ts`, `packages/shield/src/policy/policy-schema.ts`).
- **A per-decision audit record.** Once a sink is supplied, every decision appends exactly one event carrying the five fields named above; the audit is the trace that a decision was taken and on what basis (`packages/shield/src/audit.ts`, `packages/shield/src/evaluate.ts`).

The third decision value, `needs_approval`, and the approval checkpoint behind it are this package's own documented extension of a conventional allow-or-deny engine. There is no authoritative three-valued reference implementation, and nothing here should be read as a standard result.

## Threats this design addresses

| Threat | Mitigation | Where it lives |
| --- | --- | --- |
| An unmatched call is allowed by accident | Default deny: no rule matches → `deny` / `no_matching_rule` | `packages/shield/src/evaluate.ts` |
| A malformed call or an invalid policy slips through | Validation refuses before any match is attempted → `deny` / `malformed`, and the engine never throws | `packages/shield/src/evaluate.ts`, `packages/shield/src/policy/policy-schema.ts` |
| A policy gains meaning from keys the format does not define | Strict validation rejects an unrecognised key at either level, a duplicate rule id, a missing or empty required field, a non-array `rules` and an unknown `decision` value — none is silently ignored | `packages/shield/src/policy/policy-schema.ts` |
| An undecidable input is treated as permission | Fail closed: an unreadable input is a refusal, never a grant | `packages/shield/src/evaluate.ts` |
| A decision is taken with no record of it | Exactly one audit event per decision once a sink is supplied, with the five fixed fields | `packages/shield/src/evaluate.ts`, `packages/shield/src/audit.ts` |
| A `needs_approval` call proceeds with no approval | The call blocks until a recorded approval exists for that call id; with no approval store supplied, or one that answers no or cannot answer, the decision stays `needs_approval` | `packages/shield/src/approvals.ts`, `packages/shield/src/evaluate.ts` |
| The audit trail is lost through a directory that does not exist yet | The file sink creates its parent directory on its first append, so the path is written rather than refused | `packages/shield/src/audit.ts` |
| A policy is used as a code-execution vector | A policy is parsed and inspected as data — no `eval`, no `new Function`, no dynamic `import()`, no network call | `packages/shield/src/policy/policy-schema.ts`, `packages/shield/src/policy/load-policy.ts` |
| A rule is silently overridden by a later one | Rules are evaluated in declaration order and the **first** match decides | `packages/shield/src/policy/match-rule.ts` |
| A policy is applied but its revision cannot be identified in the trail | The policy's `version` is recorded as `AuditEvent.policyVersion` | `packages/shield/src/audit.ts`, `packages/shield/src/policy/policy-schema.ts` |

## Known limitations and residual risk

- **Approvals are keyed by call id alone.** `packages/shield/src/approvals.ts` indexes approvals by call id and nothing else, so Shield cannot tell whether the call now being evaluated is the same call a human approved. A caller that reuses a call id can therefore have an unrelated call released by an earlier approval. The mitigation is the adopter's: give every call a unique id, and show the call itself to the approver. The store is append-only — no update and no delete function exists anywhere in the package — and the first approval recorded for an id wins.
- **Enforcement is not delivered.** `evaluate` returns a record and installs no interposition, so a caller that ignores the result is unaffected by it: a decision is advice until the caller acts on it.
- **A failing audit sink does not throw.** Because `evaluate` promises never to throw, a faulty or unwritable caller-supplied sink cannot surface as an exception from the decision, so an audit line can be lost without changing or failing the decision that produced it. The mitigation is the adopter's: monitor the sink and treat the trail beyond the append Shield performs as the adopter's own obligation.
- **An empty `policyVersion` is possible.** `readPolicyVersion` answers with the document's own `version` when it is a non-empty string and with `""` otherwise — including when the document failed validation for some other reason. An audit line can therefore lack a version by design, and a non-empty version is not proof that the policy was valid.
- **Strict validation is not a judgement of policy quality.** It rejects malformed documents, not unwise ones: a valid policy can be far more permissive than a reader expects.
- **No isolation and no network mediation.** Shield spawns and contains nothing, makes no network call and mediates no connection; the only external runtime import in the entire package is `node:fs` in `packages/shield/src/audit.ts`, and a policy that denies a tool named for a network operation denies a decision about a call, not a connection.
- **Per-process state only.** The in-memory log and the approval store are per-process objects with no coordination between processes, so two processes evaluating the same call id will not agree on approvals.

The full exclusions list, where these limits become obligations the adopter carries, is `docs/shield/EXCLUSIONS.md`.

## What this model does not claim

- No certification, and no independent verification of any kind.
- No conformance to any framework, standard or regulation, and no audit or compliance coverage.
- No universal safety, and no claim that Shield makes an application, a process or a tool call secure.
- No claim that a policy creates a technical boundary: a written rule is a decision, not an isolation mechanism, and saying a tool is denied changes nothing about what the process can do.
- No claim that a Shield decision is a pass, a certification, an audit result or a measure of safety.

Shield produces neither `SAMPLE` nor `VERIFIED-IN-DEMO`: those two labels belong to evaluation reports and to the badge scope "structured output on fixture set only" under `docs/STANDARD-SGI-SO-1.0.0.md`, and they appear in no Shield output. No document in this repository describes any part of the system as certified, independently verified or safe for arbitrary workloads.

## Reporting a vulnerability

Report a suspected vulnerability through the process described in `SECURITY.md`, which routes through the hosting platform's private vulnerability-reporting channel and publishes no email address and no personal contact detail, because a real contact detail is itself a prohibited item in this repository. A Shield security fix is in scope for `packages/shield/`, which is one of the `.github/CODEOWNERS`-protected paths and is exactly what `SECURITY.md` lists as in scope. No response time, no service level and no other contact route is offered here.

## Read next

- `docs/shield/README.md` — usage and the fixed decision contract.
- `docs/shield/POLICY-FORMAT.md` — the policy format these threats concern.
- `docs/shield/EXCLUSIONS.md` — the same limits stated as obligations.
- `docs/THREAT-MODEL.md` — this repository's own model, which this document parallels and does not repeat.
- `SECURITY.md` — how to report an issue.
