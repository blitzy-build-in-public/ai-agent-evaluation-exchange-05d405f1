# ADEM Shield Basic: what it does not do

ADEM Shield Basic is a small in-process library: a caller hands `evaluate` a tool call and a policy, and receives one decision record. This document lists what that library does not do, so an adopter can size it honestly before building on it; every entry is a denial, and the list is short because the package is.

1. **Not a sandbox. It provides no isolation of untrusted code.** `evaluate` decides about a call the caller has already constructed and will itself perform (`packages/shield/src/evaluate.ts`). Shield spawns no process, contains nothing and supervises nothing: nothing under `packages/shield/src/` starts, sandboxes or confines any code. An adopter that runs untrusted code needs an operating-system or container boundary that this package does not provide, and must not be told it has one.

2. **Does not mediate network access.** There is no network client anywhere in the package: the only external import in the whole of `packages/shield/src/` is the Node built-in `node:fs` in `packages/shield/src/audit.ts`. Shield cannot block, inspect, proxy or log a network request, and nothing in it observes traffic. A policy written to deny a tool named for a network operation denies a *decision* about a call, not a connection: if the caller performs the call anyway, the connection happens.

3. **Does not enforce anything against a caller that ignores its decision.** `evaluate` returns a decision record (`packages/shield/src/evaluate.ts`) and the caller decides what to do with it. Shield installs no interposition, no hook, no interceptor and no wrapper around any tool, so a caller that discards the record — or performs the call regardless — is unaffected by it. Enforcement is the adopting application's responsibility.

4. **No persistence or durability guarantee beyond the caller-supplied audit sink.** The in-memory log lives in the process and dies with it; the file sink appends one newline-delimited JSON line per event to the path the caller supplies and creates that path's parent directory on the first append (`packages/shield/src/audit.ts`). There is no database, no rotation, no fsync policy, no retention rule, no replication and no tamper-evidence. The cost of the never-throws promise belongs here too: because `evaluate` guarantees it never throws, an append that fails cannot surface as an exception from the decision, so a faulty or unwritable sink can lose an audit line without changing the decision it recorded. A caller that requires the trail must monitor its own sink.

5. **No protection against a malicious policy author.** A policy determines what is allowed, and Shield carries the policy's meaning out faithfully. It has no notion of who wrote the document: no signature check, no trust store, no review step and no allowlist of permitted rule shapes beyond the format's own strict validation (`packages/shield/src/policy/policy-schema.ts`). Strict validation rejects a *malformed* document, not a *hostile* one. A caller that accepts a policy from an untrusted source is trusting that source.

6. **Not a gate pass and not a security guarantee.** Shield has no relationship to the Standard Gate Index: it produces no report and neither of the report labels `SAMPLE` and `VERIFIED-IN-DEMO`, and its decisions appear in no evaluation evidence. A Shield decision must never be presented as a pass, a certification, an audit result or a measure of safety — neither for the call it decided nor for anything else.

7. **A written policy does not create technical isolation.** A document that says a tool is denied changes nothing about what the process can do; it changes what the caller has been told to do. A rule is a decision, not a boundary, and Shield is the code that reads that decision back.

8. **No authentication, identity, session or credential handling.** Shield has no notion of who the caller is or on whose behalf it acts. The `callId`, `approvedBy` and `reason` fields of an approval record are opaque strings supplied by the caller (`packages/shield/src/approvals.ts`), and Shield verifies none of them — no signature, no session, no expiry, no authority. It reads no environment variable, no secret and no configuration file.

9. **No verification that an approved call is the call the approver intended.** Approvals are keyed by call id alone (`packages/shield/src/approvals.ts`), so Shield cannot tell whether the call now being evaluated is the same call a person approved; and `needs_approval` is this package's own documented third outcome, not a standard result anyone has settled. The mitigation belongs to the adopter: give every call a unique id and show the call itself to the approver. The same limitation is stated in `docs/shield/THREAT-MODEL.md`.

10. **No real transactions, no money movement, no commerce.** Shield is outside the commercial path entirely: nothing in it records an amount, an offer, a ledger entry or a fee, and the synthetic-currency rules of `packages/commerce-sim/src/config.ts` do not apply to it. It is a library no workspace of this repository runs — nothing imports `packages/shield/` except its own adopters — and real payments, payouts, settlement and bank connections are outside this project altogether.

11. **No execution of submitted code, and no evaluator role.** Shield never executes anything a caller gives it: a policy is parsed and inspected as data, with no `eval`, no `new Function` and no dynamic import (`packages/shield/src/policy/load-policy.ts`, `packages/shield/src/policy/policy-schema.ts`). It is not the SGI evaluator: the deterministic evaluator lives in `packages/sgi-core/src/scoring/`, and the standard it scores against is documented in `docs/STANDARD-SGI-SO-1.0.0.md`.

12. **Not published, not a product, not supported.** `packages/shield/package.json` marks the workspace `"private": true`, declares no dependencies at all and carries no publish configuration, so Shield reaches an adopter by taking the source under the repository's MIT licence (`LICENSE`) rather than from a registry. There is no support commitment, no service level, no deprecation policy and no versioning promise beyond the repository's own.

13. **No compliance, audit or regulatory conformance.** Nothing here is certified or independently verified, and no conformance to any external standard, framework or regulation should be inferred from the presence of a policy, an approval checkpoint or an audit line.

14. **No concurrency, multi-process or distributed guarantee.** The in-memory log and the approval store are per-process objects with no coordination between processes: two processes evaluating the same call id share no state and will not agree on approvals. Shield is a small in-process library and claims nothing beyond that.

15. **No personal data, and no contact route.** Shield stores no personal information — an approval record carries caller-supplied opaque strings — and an adopter should place none in `approvedBy`, `reason` or a `callId`. This repository publishes no contact address; report a suspected vulnerability through the process in `SECURITY.md`.

## What an adopter must supply

- The process or container isolation for any untrusted code Shield decides about.
- The enforcement point that honours, overrides or ignores a decision, and the policy that says which.
- The durable store, rotation, retention and monitoring for the audit trail, including alerting on a sink that stops writing.
- The provenance, review and distribution rules for any policy document from a source you do not control.
- The identity, session and authority handling around an approval, and the interface that shows an approver the call they are approving.
- Unique call ids, so an approval covers the call it was granted for.
- Your own compliance, audit and regulatory work, for whatever regime applies to you.

## Read next

- `docs/shield/README.md` — usage and the decision contract.
- `docs/shield/POLICY-FORMAT.md` — the policy format these exclusions qualify.
- `docs/shield/THREAT-MODEL.md` — the supported threat model in full.
- `docs/THREAT-MODEL.md` — this repository's own threat model.
- `SECURITY.md` — how to report an issue.
