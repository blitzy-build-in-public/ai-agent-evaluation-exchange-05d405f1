/**
 * The synthetic-account switcher: the control a reader uses to choose which demo account the
 * next write is sent as.
 *
 * It is one labelled `<select>` whose options are the six synthetic accounts, grouped by role
 * through `<optgroup>` in the role order `ACCOUNT_ROLES` fixes, so the order can never drift
 * from the account data. Each option's value is the account identifier, because that identifier
 * — not the handle — is the string the write header carries.
 *
 * The demonstration label sits beside the control rather than only in the banner: a switcher
 * whose disclosure stands somewhere else, or which disappears at a narrow width, has not
 * disclosed anything. It is rendered from `DEMO_AUTHENTICATION_LABEL`, the single definition of
 * that sentence, so the two surfaces cannot say different things.
 *
 * Two writers of the selected account exist on purpose. The parent passes the current `value`
 * and receives every change through `onChange`, and this component also writes the selection to
 * the client's own module state — before it reports the change, never after — so the account
 * the next write is sent as is current even if the parent's handler lags a render behind.
 *
 * Presentation only: no request, no storage of its own, no navigation and no state beyond what
 * the parent supplies. The header itself is attached by the API client, and a demo account is a
 * synthetic role selector rather than authentication of any identity.
 */
import { useId } from "react";
import type { ChangeEvent } from "react";
import { ACCOUNT_ROLES, DEMO_AUTHENTICATION_LABEL } from "@adem/shared";
import type { AccountRole } from "@adem/shared";
import { setSelectedDemoAccountId } from "../api-client";
import { demoAccountsForRole, findDemoAccount } from "../data/demo-accounts";

/** What each option group is called, keyed by the role the contract carries. */
const ROLE_GROUP_LABELS: Readonly<Record<AccountRole, string>> = {
  developer: "Developer",
  buyer: "Buyer",
  contributor: "Contributor",
  operator: "Operator",
};

/** The visible label of the control, naming what the selection decides. */
const CONTROL_LABEL = "Demo account";

/** The option a first visit and a stored selection naming no account share: no account is held. */
const NO_ACCOUNT_LABEL = "No demo account selected";

/**
 * Props for {@link DemoAccountSwitcher}: the selection and its reporter, both owned by the
 * shell so that one place knows which account the session is using.
 */
export interface DemoAccountSwitcherProps {
  /** The `accounts.id` of the selected demo account, or `null` when none is selected. */
  readonly value: string | null;
  /** Reports the chosen `accounts.id`. */
  readonly onChange: (id: string) => void;
}

/** One role's option group, or `null` when the role holds no account to offer. */
function renderRoleGroup(role: AccountRole): JSX.Element | null {
  const accounts = demoAccountsForRole(role);
  if (accounts.length === 0) {
    return null;
  }
  return (
    <optgroup key={role} label={ROLE_GROUP_LABELS[role]}>
      {accounts.map(
        (account): JSX.Element => (
          // The id is the value, never the handle: it is what the write header carries, and the
          // identifier the API resolves first, so an option holding anything else would still pass
          // through a fallback while every check on this control read the wrong string.
          <option key={account.id} value={account.id}>
            {account.display_label}
          </option>
        ),
      )}
    </optgroup>
  );
}

/**
 * The switcher: pick the demo account every later write is made as.
 *
 * A value that names no account — a selection stored by a previous visit, or anything else
 * written into storage — renders the unselected state rather than leaving the control on a value
 * it does not hold, so it can never show one account while the API client would send another.
 *
 * The absent-state option is rendered only while nothing is selected, and that is deliberate. A
 * placeholder left in the list after an account is chosen would offer a reader a way back to
 * "none": the browser would accept the empty value and fire a change, this component would clear
 * the client's account, and the browser would then restore the control to the account its `value`
 * still names — leaving the control showing an account the next write would not be sent as.
 */
export function DemoAccountSwitcher({ value, onChange }: DemoAccountSwitcherProps): JSX.Element {
  const selectId = useId();
  const disclosureId = useId();

  const selectedAccount = findDemoAccount(value);
  const selectedId = selectedAccount === null ? "" : selectedAccount.id;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const id = event.target.value;
    setSelectedDemoAccountId(id === "" ? null : id);
    if (id !== "") {
      onChange(id);
    }
  };

  return (
    <div className="demo-account-switcher">
      <label className="field__label" htmlFor={selectId}>
        {CONTROL_LABEL}
      </label>
      <select
        id={selectId}
        value={selectedId}
        onChange={handleChange}
        aria-describedby={disclosureId}
      >
        {selectedId === "" ? <option value="">{NO_ACCOUNT_LABEL}</option> : null}
        {ACCOUNT_ROLES.map((role: AccountRole): JSX.Element | null => renderRoleGroup(role))}
      </select>
      <span className="demo-account-switcher__label" id={disclosureId}>
        {DEMO_AUTHENTICATION_LABEL}
      </span>
    </div>
  );
}
