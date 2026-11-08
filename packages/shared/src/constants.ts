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
 * The fixed size of one page of a bounded collection read: the operator audit feed
 * (`GET /audit-events`), the three ledger reads (`GET /ledger/marketplace`,
 * `GET /ledger/gate-fees`, `GET /ledger/founder-allocation`), the challenges and threads
 * boards (`GET /challenges`, `GET /threads`), the standards catalogue's proposals
 * (`GET /standards`) and a listing's version history (`GET /listings/{id}`).
 *
 * Every one of those reads is served over a table that grows with use — an append-only
 * ledger or feed, or a board a visitor can add to — and a response that carried the whole
 * table would grow with it without bound. Each therefore answers with one page of its
 * collection and states the page it answered and how many rows the collection holds, so a
 * client can read the rest by asking for the next page. A `page` query parameter
 * (`COLLECTION_PAGE_SIZE` rows per page) is the only paging input; there is no
 * page-size parameter on any of those rows, exactly as there is none on the search.
 *
 * It is the same number as {@link LISTING_PAGE_SIZE} on purpose — the product has one page
 * size — but it is defined separately because the two bound different surfaces: the search
 * pages a filtered catalogue, these page an append-only or visitor-written collection.
 */
export const COLLECTION_PAGE_SIZE = 20;

/**
 * The largest `page` any paged read accepts: the page past which the product can no longer
 * state where the page starts.
 *
 * Every paged read turns its page into numbers it hands the storage layer, and those numbers
 * are reproduced exactly only while they stay whole: the page's own offset,
 * `COLLECTION_PAGE_SIZE * (page - 1)` on the eight bounded collection reads and
 * `LISTING_PAGE_SIZE * (page - 1)` on the listing search, and the rank window's end,
 * `COLLECTION_PAGE_SIZE * page`, on the standards catalogue. A JavaScript number states
 * whole numbers exactly only up to `Number.MAX_SAFE_INTEGER` (2^53 - 1 = 9007199254740991),
 * so a page beyond this bound asks for a number the arithmetic rounds:
 * `?page=9007199254740993`, the first whole number after the safe range, asks for the offset
 * 180143985094819860 and produces 180143985094819800. The storage layer then refuses the
 * rounded operand rather than degrading — SQLite answers `SQLITE_MISMATCH` ("datatype
 * mismatch") for a windowed statement, and `@adem/commerce-sim`'s `listLedgerEntries`
 * refuses an `offset` outside the safe range with a `RangeError` — and every one of those
 * reaches the client as `500 internal_error`, a server fault for a request a client can
 * correct.
 *
 * The value is `Math.floor(Number.MAX_SAFE_INTEGER / COLLECTION_PAGE_SIZE)`, the largest page
 * for which both numbers a read forms from it stay inside that range, so the bound is the
 * product's own statement of where its arithmetic stays exact rather than a number chosen
 * beside it: 450359962737049 forms the offset 9007199254740960 and the rank window's end
 * 9007199254740980, while the page after it, 450359962737050, forms 9007199254741000 and
 * leaves the range. Every `page` the eight bounded collection reads declare therefore carries
 * this value as its `maximum`, and a page beyond it fails that schema's constraint at the edge,
 * refused `400 validation_error` through the one error envelope exactly as `?page=0`,
 * `?page=-1` and `?page=abc` are. The listing search answers the other end of the same
 * question in its own route instead: it judges the offset it is about to bind and refuses a
 * page the store cannot address with the same `400`, naming the parameter the client sent.
 */
export const PAGE_NUMBER_MAX = 450359962737049;

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
