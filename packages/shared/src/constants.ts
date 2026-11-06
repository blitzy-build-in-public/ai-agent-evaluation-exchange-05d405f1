/**
 * The product's closed vocabulary and the numbers its API contract fixes, each
 * defined once. Every value here is a fixed interface: the label and copy strings
 * are asserted in rendered text, and the paging and rate-limit numbers are read by
 * the API and by its documented contract from this one definition.
 */

/**
 * The synthetic currency label. Every monetary amount in this product is an integer
 * count of minor units of this label, and there is no real currency code or symbol
 * anywhere. Consumed by the commerce simulation's configuration, the API and the UI.
 */
export const SYNTHETIC_CURRENCY_LABEL = "DEMO";

/**
 * The report label for a report whose candidate version is a fixture candidate.
 * The label vocabulary is closed to this value and {@link REPORT_LABEL_VERIFIED_IN_DEMO};
 * the report type derives its label union from these two.
 */
export const REPORT_LABEL_SAMPLE = "SAMPLE";

/**
 * The report label for a report whose candidate version was published through the API
 * rather than seeded as a fixture. The second and last member of the closed label
 * vocabulary; no third label may be introduced.
 */
export const REPORT_LABEL_VERIFIED_IN_DEMO = "VERIFIED-IN-DEMO";

/**
 * The scope string every badge carries, alongside the standard version and the report
 * ID. It states the only thing a badge measures. Consumed by the sample-badge component.
 */
export const BADGE_SCOPE = "structured output on fixture set only";

/**
 * The label that must be visible wherever the demo-account switcher appears, stating
 * that a demo session is not authentication of any identity. Asserted in rendered text.
 */
export const DEMO_AUTHENTICATION_LABEL = "demo only, no production authentication";

/**
 * The copy rendered for a listing that has no evaluation report yet, in place of a
 * badge or an outcome.
 */
export const NO_REPORT_LABEL = "No SGI report yet";

/**
 * The label the UI and the documentation put on the founder-allocation contract
 * structure, which carries no personal identity, beneficiary account or entitlement.
 * Consumed by the ledger table.
 */
export const FOUNDER_ALLOCATION_CONTRACT_LABEL = "to be determined";

/**
 * The label every sponsored item renders. Sponsored items form their own labelled
 * collection and are never interleaved with organic results. Consumed by the
 * sponsored-label component and asserted in rendered text.
 */
export const SPONSORED_LABEL = "Sponsored";

/**
 * The fixed page size of paginated listing search. A `page` query parameter is the only
 * paging input; there is no page-size parameter. Consumed by the API configuration and
 * by the listing search schema.
 */
export const LISTING_PAGE_SIZE = 20;

/**
 * The number of write requests allowed per window per client. A write beyond it is
 * refused with HTTP 429 and a `Retry-After` header. Consumed by the API configuration
 * and registered as the rate limit's `max`.
 */
export const WRITE_RATE_LIMIT_MAX = 60;

/**
 * The write rate-limit window, per client, in the unit-and-unit-name string form
 * `@fastify/rate-limit`'s `timeWindow` option accepts. Registered as the rate limit's
 * `timeWindow` beside {@link WRITE_RATE_LIMIT_MAX}.
 */
export const WRITE_RATE_LIMIT_WINDOW = "1 minute";
