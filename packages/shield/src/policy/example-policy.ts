/**
 * A worked example policy: the whole of what a policy author writes, as data.
 *
 * It exists to be read and copied. `docs/shield/POLICY-FORMAT.md` walks through
 * it, and the Shield tests use it as their fixture, so its rule ids and argument
 * shapes are public and stay stable.
 *
 * Two details carry meaning beyond the data itself. The wildcard rule comes
 * first because rules are read in order and the first match decides: a wildcard
 * placed last would let an earlier allow rule answer a high-risk call first,
 * which would teach the wrong lesson about ordering. And one of the fictional
 * tool names this example works with is left out of every rule on purpose, so a
 * call against it finds no match and the engine's default deny is shown rather
 * than assumed.
 *
 * The file holds no logic: it is not validated at import time, and it carries no
 * rule that allows every tool, because a catch-all allow would leave that
 * default deny unreachable.
 */
import type { Policy } from "./policy-schema";

/** Five rules covering each decision, both wildcards and a tool-only rule. */
export const examplePolicy: Policy = {
  version: "example-1.0.0",
  rules: [
    {
      id: "deny-high-risk-call",
      tool: "*",
      decision: "deny",
      reason: "A call marked high risk is refused before any later rule can match it.",
      arguments: { risk: "high" },
    },
    {
      id: "allow-read-file",
      tool: "read_file",
      decision: "allow",
      reason: "Reading a file inside the workspace is permitted by this example policy.",
      arguments: { scope: "workspace" },
    },
    {
      id: "approve-write-file",
      tool: "write_file",
      decision: "needs_approval",
      reason: "Writing a file inside the workspace waits for an approval event for the call.",
      arguments: { scope: "workspace", target: "*" },
    },
    {
      id: "allow-send-message",
      tool: "send_message",
      decision: "allow",
      reason: "Sending a message on the demo channel at normal priority is permitted here.",
      arguments: { channel: "demo-channel", priority: 1, urgent: false },
    },
    {
      id: "deny-delete-record",
      tool: "delete_record",
      decision: "deny",
      reason: "Deleting a record is refused by this example policy.",
    },
  ],
};
