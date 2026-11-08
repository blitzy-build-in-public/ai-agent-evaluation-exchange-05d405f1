/**
 * The public entry of `@adem/commerce-sim`, and the only path into the package: the fictional
 * configuration, the offer vocabulary and its selector, the simulated checkout, the three
 * append-only ledgers with the allocation arithmetic behind them, and the refund path — each
 * re-exported by name from the module that owns it.
 *
 * Nothing is declared here and nothing runs here: the file is a list of named re-exports, so a
 * module that renames an export fails to compile at this line rather than reaching a consumer under
 * a name it no longer has. A wildcard re-export is deliberately absent for the same reason: it would
 * publish every helper a sub-folder module exports for its own use, and the package's surface would
 * then be whatever those modules happened to declare.
 *
 * The package's sub-folder modules are not importable from outside it. Consumers import
 * `@adem/commerce-sim` and nothing deeper, which is what `packages/commerce-sim/package.json`'s
 * single `exports` entry resolves to.
 */

export {
  COMMERCE_DISCLOSURE_LABEL,
  DEFAULT_COMMERCE_CONFIG,
  DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
  DEFAULT_GATE_FEE_MINOR_UNITS,
  resolveCommerceConfig,
} from "./config";
export type { CommerceConfig, CommerceConfigOverrides } from "./config";

export { OFFER_MODELS, isOfferModel } from "./offers/offer-model";
export type { OfferModel } from "./offers/offer-model";

export { selectOffer } from "./offers/select-offer";
export type {
  ListingOffer,
  OfferSelection,
  OfferSelectionRefusalReason,
} from "./offers/select-offer";

// `Transaction` and `Refund` are the stored row shapes, declared in `@adem/shared`, and they are
// deliberately not re-exported here: the API workspace imports them from `@adem/shared`, and a
// second import path for one type would widen this package's surface without giving a consumer
// anything — beside `insertTransaction` and `createRefund`, which return them and whose signatures
// already name them.
export { getTransaction, insertTransaction } from "./checkout/checkout-repository";
export type { TransactionInput } from "./checkout/checkout-repository";

export { createCheckoutSimulation } from "./checkout/create-checkout-simulation";
export type {
  CheckoutSimulationRefusalReason,
  CheckoutSimulationResult,
  CreateCheckoutSimulationInput,
} from "./checkout/create-checkout-simulation";

export {
  LEDGER_DIRECTIONS,
  LEDGER_ENTRY_TYPES,
  LEDGER_NAMES,
} from "./ledgers/ledger-types";
export type {
  LedgerDirection,
  LedgerEntry,
  LedgerEntryInput,
  LedgerEntryType,
  LedgerName,
} from "./ledgers/ledger-types";

export { allocate } from "./ledgers/allocate";

export { recordMarketplaceCharge } from "./ledgers/marketplace";
export type { RecordMarketplaceChargeInput } from "./ledgers/marketplace";

export { recordGateFeeCharge } from "./ledgers/gate-fees";
export type { RecordGateFeeChargeInput } from "./ledgers/gate-fees";

export { recordFounderAllocation } from "./ledgers/founder-allocation";
export type { RecordFounderAllocationInput } from "./ledgers/founder-allocation";

export {
  insertLedgerEntries,
  insertLedgerEntry,
  listLedgerEntries,
} from "./ledgers/ledger-repository";

export { buildReversalEntries } from "./refunds/reversal-entries";
export type { BuildReversalEntriesInput } from "./refunds/reversal-entries";

export { computeNetRemaining, createRefund } from "./refunds/create-refund";
export type {
  CreateRefundInput,
  RefundRefusalReason,
  RefundResult,
} from "./refunds/create-refund";
