/**
 * The fictional rows of the demonstration database: the six synthetic demo accounts, the four
 * listing categories, twelve listings with their version history and claims, the public challenge
 * board and the discussion threads, the one provisional standard and the two sponsored slots.
 *
 * It holds data and nothing else. No connection is opened, no query is built, no row is written
 * and no value is computed: every member below is a literal, because the seeded database has to be
 * the same one on every machine and on every run. `apps/api/src/seed/seed-database.ts` writes these
 * rows into the migration schema, and `apps/api/src/seed/run-seed.ts` is the `npm run seed` entry
 * that applies it to a database file.
 *
 * Every exported collection and every row literal is wrapped in `Object.freeze`. `readonly` is a
 * compile-time promise that the freeze keeps at run time, so a caller cannot edit a seeded row and
 * hand a changed value to the writer.
 *
 * All of it is fictional. No row carries a personal name, a contact detail, a credential, a token,
 * a brand, a payment-provider name or a currency symbol; every amount is an integer count of minor
 * units of the synthetic `DEMO` currency; and every timestamp is a fixed ISO-8601 UTC literal
 * rather than a clock reading, which is what lets two runs of the seed agree byte for byte.
 *
 * Ids follow one shape: a readable eight-character prefix, then the four hexadecimal groups that
 * complete a UUID, with digits interleaved among the letters inside every group. The prefix holds
 * at most four digits, so the only runs of five or more digits in this file are the three fixed
 * candidate constants below — the invariant the folder's content check greps for, kept because a
 * longer digit run could be read as a telephone-number pattern by `scripts/scan-exclusions.ts`. No
 * seeded value here contains an at-sign either: the only at-signs in the file are the module
 * specifier of the type-only import below and the documentation cross-references in these comments.
 * A new id therefore takes the prefix scheme rather than a longer digit run, and the three fixed
 * constants are never altered.
 */

import type {
  Account,
  Category,
  Challenge,
  ChallengeResponse,
  Listing,
  ListingClaim,
  ListingVersion,
  RecordedOutput,
  SponsoredSlot,
  Standard,
  Thread,
  ThreadPost,
} from "@adem/shared";

/**
 * The `listing_versions.id` of the seed-alpha candidate, which is also the `candidate_version_id`
 * the fixture pack records for it.
 *
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/seed-alpha.json` states this exact value,
 * so the version row the seed writes and the submission the case set describes name the same
 * version. It is fixed data rather than something generated, and it is never regenerated,
 * reformatted or corrected.
 */
export const SEED_ALPHA_VERSION_ID = "00000000-0000-4000-8000-0000000000a1";

/**
 * The `listing_versions.id` of the seed-beta candidate, which is also the `candidate_version_id`
 * the fixture pack records for it.
 *
 * The beta version's recorded output for the critical case `so-003` differs from that case's
 * expected output, which is what makes beta the seeded critical-case failure. As with
 * {@link SEED_ALPHA_VERSION_ID}, the value is fixed by the fixture pack and never altered.
 */
export const SEED_BETA_VERSION_ID = "00000000-0000-4000-8000-0000000000b2";

/**
 * The `listing_versions.id` of the seed-gamma candidate, which is also the `candidate_version_id`
 * the fixture pack records for it.
 *
 * The gamma version misses three `standard` cases and no critical one, which is what makes it the
 * seeded threshold failure. As with {@link SEED_ALPHA_VERSION_ID}, the value is fixed by the
 * fixture pack and never altered.
 */
export const SEED_GAMMA_VERSION_ID = "00000000-0000-4000-8000-0000000000c3";

/**
 * The `accounts.id` of the first synthetic developer account.
 *
 * A developer is the only role that may publish a listing, publish a version of the listing it
 * owns, or start an evaluation, so this account owns every seeded listing.
 */
export const SEED_DEVELOPER_ACCOUNT_ID = "acct0001-0a1b-4c2d-9e3f-a1b2c3d4e5f6";

/**
 * The `accounts.id` of the second synthetic developer account, which owns no seeded listing.
 *
 * It exists so that the ownership half of the contract is reachable: `POST /listings/{id}/versions`
 * answers `403` for a resolved developer that does not own the listing, and only a second account
 * that is a developer but not the owner can tell that refusal apart from a role refusal.
 */
export const SEED_SECOND_DEVELOPER_ACCOUNT_ID = "acct0002-1b2c-4d3e-8f4a-b2c3d4e5f6a7";

/**
 * The `accounts.id` of the first synthetic buyer account, which raises the seeded open challenge
 * and posts the seeded inquiry.
 */
export const SEED_BUYER_ACCOUNT_ID = "acct0003-2c3d-4e4f-9a5b-c3d4e5f6a7b8";

/**
 * The `accounts.id` of the second synthetic buyer account.
 *
 * It exists so that the two challenge states are honestly reachable: the board carries one `open`
 * challenge and one `responded` challenge raised by two different buyers, and a single buyer
 * account could not hold both without the second state reading as a self-answer.
 */
export const SEED_SECOND_BUYER_ACCOUNT_ID = "acct0004-3d4e-4f5a-8b6c-d4e5f6a7b8c9";

/**
 * The `accounts.id` of the synthetic community contributor account, which authors the seeded
 * discussion thread about the standard's proposal route.
 */
export const SEED_CONTRIBUTOR_ACCOUNT_ID = "acct0005-4e5f-4a6b-9c7d-e5f6a7b8c9da";

/**
 * The `accounts.id` of the synthetic operator account, the only role that may review a proposal,
 * rule on an appeal, refund a simulated transaction, moderate a listing, or read the ledgers and
 * the audit feed.
 */
export const SEED_OPERATOR_ACCOUNT_ID = "acct0006-5f6a-4b7c-8d8e-f6a7b8c9dae1";

/**
 * The six synthetic accounts the `X-Demo-Account` header resolves to, one per role plus the two
 * extras named above.
 *
 * Each row is a fictional handle and a display label and nothing else: the `accounts` table has no
 * credential, session, contact or personal-name column, and none may be added, because a demo
 * session carries no authentication to vouch for. The two extras are the second developer (the
 * ownership `403`) and the second buyer (the two challenge states); no route needs a seventh, so
 * the set ends here.
 */
export const SEED_ACCOUNTS: readonly Account[] = Object.freeze([
  Object.freeze({
    id: SEED_DEVELOPER_ACCOUNT_ID,
    handle: "demo-developer",
    role: "developer",
    display_label: "Demo developer account",
  }),
  Object.freeze({
    id: SEED_SECOND_DEVELOPER_ACCOUNT_ID,
    handle: "demo-developer-two",
    role: "developer",
    display_label: "Second demo developer account",
  }),
  Object.freeze({
    id: SEED_BUYER_ACCOUNT_ID,
    handle: "demo-buyer",
    role: "buyer",
    display_label: "Demo buyer account",
  }),
  Object.freeze({
    id: SEED_SECOND_BUYER_ACCOUNT_ID,
    handle: "demo-buyer-two",
    role: "buyer",
    display_label: "Second demo buyer account",
  }),
  Object.freeze({
    id: SEED_CONTRIBUTOR_ACCOUNT_ID,
    handle: "demo-contributor",
    role: "contributor",
    display_label: "Demo contributor account",
  }),
  Object.freeze({
    id: SEED_OPERATOR_ACCOUNT_ID,
    handle: "demo-operator",
    role: "operator",
    display_label: "Demo operator account",
  }),
]);

/** The `categories.id` of the order-intake category, the category the three fixture candidates sit in. */
export const SEED_CATEGORY_ORDER_INTAKE_ID = "cate0001-6a7b-4c8d-9e9f-a7b8c9dae1f2";

/** The `categories.id` of the depot-routing category. */
export const SEED_CATEGORY_DEPOT_ROUTING_ID = "cate0002-7b8c-4d9e-8f1a-b8c9dae1f2a3";

/** The `categories.id` of the record-keeping category. */
export const SEED_CATEGORY_RECORD_KEEPING_ID = "cate0003-8c9d-4e1f-9a2b-c9dae1f2a3b4";

/** The `categories.id` of the notification-drafting category. */
export const SEED_CATEGORY_NOTIFICATION_DRAFTING_ID = "cate0004-9d1e-4f2a-8b3c-dae1f2a3b4c5";

/**
 * The four listing categories the seeded listings sit in, three listings to a category.
 *
 * Each `slug` satisfies the `ListingCategory` extension seam's own pattern,
 * `^[a-z][a-z0-9-]{1,31}$`, so a seeded category is a value a community extension could equally
 * have registered through that seam; `apps/web`'s listing filter carries the slug and the seed
 * carries the id a listing references.
 */
export const SEED_CATEGORIES: readonly Category[] = Object.freeze([
  Object.freeze({
    id: SEED_CATEGORY_ORDER_INTAKE_ID,
    slug: "order-intake",
    name: "Order intake",
  }),
  Object.freeze({
    id: SEED_CATEGORY_DEPOT_ROUTING_ID,
    slug: "depot-routing",
    name: "Depot routing",
  }),
  Object.freeze({
    id: SEED_CATEGORY_RECORD_KEEPING_ID,
    slug: "record-keeping",
    name: "Record keeping",
  }),
  Object.freeze({
    id: SEED_CATEGORY_NOTIFICATION_DRAFTING_ID,
    slug: "notification-drafting",
    name: "Notification drafting",
  }),
]);

/** The `listings.id` of the first order-intake listing, whose only version is the alpha candidate. */
export const SEED_LISTING_INTAKE_DESK_ID = "list0001-1a2b-4c3d-9e4f-a1b2c3d4e5f6";

/** The `listings.id` of the second order-intake listing, whose only version is the beta candidate. */
export const SEED_LISTING_INTAKE_QUEUE_ID = "list0002-2b3c-4d4e-8f5a-b2c3d4e5f6a7";

/** The `listings.id` of the third order-intake listing, whose only version is the gamma candidate. */
export const SEED_LISTING_INTAKE_HANDOVER_ID = "list0003-3c4d-4e5f-9a6b-c3d4e5f6a7b8";

/** The `listings.id` of the first depot-routing listing. */
export const SEED_LISTING_DEPOT_ROUTE_PLANNER_ID = "list0004-4d5e-4f6a-8b7c-d4e5f6a7b8c9";

/** The `listings.id` of the second depot-routing listing. */
export const SEED_LISTING_DEPOT_LOAD_ID = "list0005-5e6f-4a7b-9c8d-e5f6a7b8c9da";

/** The `listings.id` of the third depot-routing listing. */
export const SEED_LISTING_DEPOT_HANDOVER_ID = "list0006-6f7a-4b8c-8d9e-f6a7b8c9dae1";

/**
 * The `listings.id` of the first record-keeping listing, the one listing that publishes two versions
 * and therefore the one whose version history is more than a single row.
 */
export const SEED_LISTING_LEDGER_KEEPER_ID = "list0007-7a8b-4c9d-9e1f-a7b8c9dae1f2";

/** The `listings.id` of the second record-keeping listing. */
export const SEED_LISTING_RECORD_INDEX_ID = "list0008-8b9c-4d1e-8f2a-b8c9dae1f2a3";

/**
 * The `listings.id` of the third record-keeping listing, the second listing that publishes two
 * versions.
 */
export const SEED_LISTING_ARCHIVE_SUMMARY_ID = "list0009-9c1d-4e2f-9a3b-c9dae1f2a3b4";

/** The `listings.id` of the first notification-drafting listing. */
export const SEED_LISTING_NOTICE_DRAFTER_ID = "list0010-1d2e-4f3a-8b4c-dae1f2a3b4c5";

/** The `listings.id` of the second notification-drafting listing. */
export const SEED_LISTING_NOTICE_REVIEW_ID = "list0011-2e3f-4a4b-9c5d-e1f2a3b4c5d6";

/** The `listings.id` of the third notification-drafting listing. */
export const SEED_LISTING_NOTICE_COMPOSER_ID = "list0012-3f4a-4b5c-8d6e-f2a3b4c5d6e7";

/**
 * The twelve seeded listings: three in each of the four categories, every one `active`, all of them
 * owned by the first developer account.
 *
 * The second developer owns none of them, which is what keeps the version route's ownership refusal
 * reachable against seeded data. The four pricing models are covered three times each — purchase,
 * rent, license and subscription — because the checkout builds a listing's offers from the model it
 * claims and an eligible purchase has to be reachable without creating a listing first.
 *
 * `created_at` and `updated_at` are fixed ISO-8601 UTC literals, one per row and equal to each
 * other, so seeding reads no clock at all; `summary` is one invented sentence and each `title` an
 * invented product name for an agent or an agent group.
 */
export const SEED_LISTINGS: readonly Listing[] = Object.freeze([
  Object.freeze({
    id: SEED_LISTING_INTAKE_DESK_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "intake-desk-agent",
    title: "Intake Desk Agent",
    summary:
      "Reads the free-text notes that arrive with an order and records each one as a structured intake entry.",
    category_id: SEED_CATEGORY_ORDER_INTAKE_ID,
    license_code: "MIT",
    pricing_model: "purchase",
    status: "active",
    created_at: "2024-03-01T09:00:00.000Z",
    updated_at: "2024-03-01T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_INTAKE_QUEUE_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "intake-queue-agent",
    title: "Intake Queue Agent",
    summary:
      "Sorts incoming order notes into a queue and records the handling each queued note needs.",
    category_id: SEED_CATEGORY_ORDER_INTAKE_ID,
    license_code: "Apache-2.0",
    pricing_model: "rent",
    status: "active",
    created_at: "2024-03-02T09:00:00.000Z",
    updated_at: "2024-03-02T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_INTAKE_HANDOVER_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "intake-handover-agent",
    title: "Intake Handover Agent",
    summary:
      "Prepares a structured handover note for the depot that takes an order on from intake.",
    category_id: SEED_CATEGORY_ORDER_INTAKE_ID,
    license_code: "BSD-3-Clause",
    pricing_model: "license",
    status: "active",
    created_at: "2024-03-03T09:00:00.000Z",
    updated_at: "2024-03-03T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_DEPOT_ROUTE_PLANNER_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "depot-route-planner",
    title: "Depot Route Planner",
    summary:
      "Plans each leg between two depots and records the leg with the distance it covers.",
    category_id: SEED_CATEGORY_DEPOT_ROUTING_ID,
    license_code: "MIT",
    pricing_model: "subscription",
    status: "active",
    created_at: "2024-03-04T09:00:00.000Z",
    updated_at: "2024-03-04T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_DEPOT_LOAD_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "depot-load-balancer",
    title: "Depot Load Balancer",
    summary:
      "Spreads a day of inbound loads across a depot's bays and records the assignment it chose.",
    category_id: SEED_CATEGORY_DEPOT_ROUTING_ID,
    license_code: "Apache-2.0",
    pricing_model: "purchase",
    status: "active",
    created_at: "2024-03-05T09:00:00.000Z",
    updated_at: "2024-03-05T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_DEPOT_HANDOVER_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "depot-handover-planner",
    title: "Depot Handover Planner",
    summary:
      "Records which bay and which team take an order at the end of a depot leg.",
    category_id: SEED_CATEGORY_DEPOT_ROUTING_ID,
    license_code: "BSD-3-Clause",
    pricing_model: "rent",
    status: "active",
    created_at: "2024-03-06T09:00:00.000Z",
    updated_at: "2024-03-06T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_LEDGER_KEEPER_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "ledger-keeper-agent",
    title: "Ledger Keeper Agent",
    summary:
      "Keeps a running record of order states and records each change beside the reason for it.",
    category_id: SEED_CATEGORY_RECORD_KEEPING_ID,
    license_code: "MIT",
    pricing_model: "license",
    status: "active",
    created_at: "2024-03-07T09:00:00.000Z",
    updated_at: "2024-03-07T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_RECORD_INDEX_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "record-index-agent",
    title: "Record Index Agent",
    summary:
      "Indexes order records so a later lookup finds them by depot and by the day they were opened.",
    category_id: SEED_CATEGORY_RECORD_KEEPING_ID,
    license_code: "Apache-2.0",
    pricing_model: "subscription",
    status: "active",
    created_at: "2024-03-08T09:00:00.000Z",
    updated_at: "2024-03-08T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_ARCHIVE_SUMMARY_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "archive-summary-agent",
    title: "Archive Summary Agent",
    summary:
      "Summarises a closed order's records and records the summary beside the records it read.",
    category_id: SEED_CATEGORY_RECORD_KEEPING_ID,
    license_code: "BSD-3-Clause",
    pricing_model: "purchase",
    status: "active",
    created_at: "2024-03-09T09:00:00.000Z",
    updated_at: "2024-03-09T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_NOTICE_DRAFTER_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "notice-drafter-agent",
    title: "Notice Drafter Agent",
    summary:
      "Drafts a short notice about an order's recorded state for the team that asked about it.",
    category_id: SEED_CATEGORY_NOTIFICATION_DRAFTING_ID,
    license_code: "MIT",
    pricing_model: "rent",
    status: "active",
    created_at: "2024-03-10T09:00:00.000Z",
    updated_at: "2024-03-10T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_NOTICE_REVIEW_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "notice-review-drafter",
    title: "Notice Review Drafter",
    summary:
      "Drafts a notice and records the points a reviewer should check before the notice is sent.",
    category_id: SEED_CATEGORY_NOTIFICATION_DRAFTING_ID,
    license_code: "Apache-2.0",
    pricing_model: "license",
    status: "active",
    created_at: "2024-03-11T09:00:00.000Z",
    updated_at: "2024-03-11T09:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_LISTING_NOTICE_COMPOSER_ID,
    developer_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    slug: "notice-composer-agent",
    title: "Notice Composer Agent",
    summary:
      "Composes a notice from an order's own records and records the fields it left unstated.",
    category_id: SEED_CATEGORY_NOTIFICATION_DRAFTING_ID,
    license_code: "BSD-3-Clause",
    pricing_model: "subscription",
    status: "active",
    created_at: "2024-03-12T09:00:00.000Z",
    updated_at: "2024-03-12T09:00:00.000Z",
  }),
]);

/** The `listing_versions.id` of the depot route planner's only version. */
const VERSION_DEPOT_ROUTE_PLANNER_ID = "vers0004-4e5f-4a6b-9c7d-e4f5a6b7c8d9";

/** The `listing_versions.id` of the depot load balancer's only version. */
const VERSION_DEPOT_LOAD_ID = "vers0005-5f6a-4b7c-8d8e-f5a6b7c8d9e1";

/** The `listing_versions.id` of the depot handover planner's only version. */
const VERSION_DEPOT_HANDOVER_ID = "vers0006-6a7b-4c8d-9e9f-a6b7c8d9e1f2";

/** The `listing_versions.id` of the ledger keeper's first version. */
const VERSION_LEDGER_KEEPER_FIRST_ID = "vers0007-7b8c-4d9e-8f1a-b7c8d9e1f2a3";

/** The `listing_versions.id` of the record index agent's only version. */
const VERSION_RECORD_INDEX_ID = "vers0008-8c9d-4e1f-9a2b-c8d9e1f2a3b4";

/** The `listing_versions.id` of the archive summary agent's first version. */
const VERSION_ARCHIVE_SUMMARY_FIRST_ID = "vers0009-9d1e-4f2a-8b3c-d9e1f2a3b4c5";

/** The `listing_versions.id` of the notice drafter's only version. */
const VERSION_NOTICE_DRAFTER_ID = "vers0010-1e2f-4a3b-9c4d-e1f2a3b4c5d6";

/** The `listing_versions.id` of the notice review drafter's only version. */
const VERSION_NOTICE_REVIEW_ID = "vers0011-2f3a-4b4c-8d5e-f2a3b4c5d6e7";

/** The `listing_versions.id` of the notice composer's only version. */
const VERSION_NOTICE_COMPOSER_ID = "vers0012-3a4b-4c5d-9e6f-a3b4c5d6e7f8";

/** The `listing_versions.id` of the ledger keeper's second version, the newer of its two rows. */
const VERSION_LEDGER_KEEPER_SECOND_ID = "vers0013-4b5c-4d6e-8f7a-b4c5d6e7f8a9";

/**
 * The `listing_versions.id` of the archive summary agent's second version, the newer of its two
 * rows.
 */
const VERSION_ARCHIVE_SUMMARY_SECOND_ID = "vers0014-5c6d-4e7f-9a8b-c5d6e7f8a9b1";

/**
 * The seeded version history: one version for every listing, plus a second version on the ledger
 * keeper and on the archive summary agent so that a version history is more than a single row.
 *
 * **Exactly three of these rows carry `is_fixture_candidate: true`** — the alpha, beta and gamma
 * candidates, whose ids are the three fixed constants above. Every other row carries `false`. The
 * flag is the only stored input to a report's label, so a stray `true` on any other row would
 * label a developer's own submission `SAMPLE`; the seed writer binds the boolean as `? 1 : 0` —
 * the SQLite driver refuses a JavaScript boolean binding and the column holds the integer 1 or 0.
 *
 * The unique `(listing_id, version_string)` pair is the only conflict the schema raises for a
 * version, and it is produced by the version route's `409` when a developer republishes a string;
 * no pair below repeats, and no `version_string` here repeats within its own listing.
 * `created_at` is a fixed ISO-8601 UTC literal that follows its listing's, so seeding reads no
 * clock.
 */
export const SEED_LISTING_VERSIONS: readonly ListingVersion[] = Object.freeze([
  Object.freeze({
    id: SEED_ALPHA_VERSION_ID,
    listing_id: SEED_LISTING_INTAKE_DESK_ID,
    version_string: "1.0.0",
    notes: "First published version, seeded as a fixture candidate of the standard's case set.",
    is_fixture_candidate: true,
    created_at: "2024-03-01T10:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_BETA_VERSION_ID,
    listing_id: SEED_LISTING_INTAKE_QUEUE_ID,
    version_string: "1.0.0",
    notes: "First published version, seeded as a fixture candidate of the standard's case set.",
    is_fixture_candidate: true,
    created_at: "2024-03-02T10:00:00.000Z",
  }),
  Object.freeze({
    id: SEED_GAMMA_VERSION_ID,
    listing_id: SEED_LISTING_INTAKE_HANDOVER_ID,
    version_string: "1.0.0",
    notes: "First published version, seeded as a fixture candidate of the standard's case set.",
    is_fixture_candidate: true,
    created_at: "2024-03-03T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_DEPOT_ROUTE_PLANNER_ID,
    listing_id: SEED_LISTING_DEPOT_ROUTE_PLANNER_ID,
    version_string: "1.0.0",
    notes: "First published version, recording each depot-to-depot leg with its distance.",
    is_fixture_candidate: false,
    created_at: "2024-03-04T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_DEPOT_LOAD_ID,
    listing_id: SEED_LISTING_DEPOT_LOAD_ID,
    version_string: "0.9.2",
    notes: "Records a bay assignment for each inbound load of the day.",
    is_fixture_candidate: false,
    created_at: "2024-03-05T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_DEPOT_HANDOVER_ID,
    listing_id: SEED_LISTING_DEPOT_HANDOVER_ID,
    version_string: "2.1.0",
    notes: "Records the bay and the team that take an order at a depot handover.",
    is_fixture_candidate: false,
    created_at: "2024-03-06T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_LEDGER_KEEPER_FIRST_ID,
    listing_id: SEED_LISTING_LEDGER_KEEPER_ID,
    version_string: "1.0.0",
    notes: "First published version of the order-state ledger.",
    is_fixture_candidate: false,
    created_at: "2024-03-07T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_RECORD_INDEX_ID,
    listing_id: SEED_LISTING_RECORD_INDEX_ID,
    version_string: "1.1.0-beta.1",
    notes: "Adds the depot and day indexes the record lookup was missing.",
    is_fixture_candidate: false,
    created_at: "2024-03-08T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_ARCHIVE_SUMMARY_FIRST_ID,
    listing_id: SEED_LISTING_ARCHIVE_SUMMARY_ID,
    version_string: "1.0.0",
    notes: "Records a closing summary beside the records of a closed order.",
    is_fixture_candidate: false,
    created_at: "2024-03-09T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_NOTICE_DRAFTER_ID,
    listing_id: SEED_LISTING_NOTICE_DRAFTER_ID,
    version_string: "0.4.0",
    notes: "Drafts a short notice about an order's recorded state.",
    is_fixture_candidate: false,
    created_at: "2024-03-10T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_NOTICE_REVIEW_ID,
    listing_id: SEED_LISTING_NOTICE_REVIEW_ID,
    version_string: "1.0.0",
    notes: "Drafts a notice and records the points a reviewer should check.",
    is_fixture_candidate: false,
    created_at: "2024-03-11T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_NOTICE_COMPOSER_ID,
    listing_id: SEED_LISTING_NOTICE_COMPOSER_ID,
    version_string: "3.0.0",
    notes: "Composes an order notice from the order's own records.",
    is_fixture_candidate: false,
    created_at: "2024-03-12T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_LEDGER_KEEPER_SECOND_ID,
    listing_id: SEED_LISTING_LEDGER_KEEPER_ID,
    version_string: "1.1.0",
    notes: "Records the reason for a state change beside the change itself.",
    is_fixture_candidate: false,
    created_at: "2024-03-13T10:00:00.000Z",
  }),
  Object.freeze({
    id: VERSION_ARCHIVE_SUMMARY_SECOND_ID,
    listing_id: SEED_LISTING_ARCHIVE_SUMMARY_ID,
    version_string: "1.1.0",
    notes: "Records which fields a closing summary left unstated.",
    is_fixture_candidate: false,
    created_at: "2024-03-14T10:00:00.000Z",
  }),
]);

/**
 * One claim per seeded version: what the version asserts about itself, the limitation the
 * developer states beside it, and the evidence the claim rests on.
 *
 * These rows are what the compare view sets side by side — a claim beside the measured evidence
 * for the same version — which is why each one carries its own `limitation` rather than claim text
 * alone: a reader has to be able to see what a version does **not** do. Each `limitation` therefore
 * states a boundary rather than an improvement, and no claim here asserts safety, security or
 * certification. `license_code` and `pricing_model` repeat the values of the listing the version
 * belongs to, because a claim is compared as claimed for that version.
 *
 * `evidence_summary` points at evidence rather than being a measurement: for the three fixture
 * candidates it names the report the seed records for them, and for every other version it records
 * that no report exists yet, which is the `No SGI report yet` state the listing pages render.
 */
export const SEED_LISTING_CLAIMS: readonly ListingClaim[] = Object.freeze([
  Object.freeze({
    id: "clai0001-1c2d-4e3f-8a4b-c1d2e3f4a5b6",
    listing_version_id: SEED_ALPHA_VERSION_ID,
    claim:
      "Records every order note that arrives as a structured intake entry with the fields the standard's case set describes.",
    limitation:
      "Covers recorded intake output only: it reads no live depot system, and nothing it records is evidence about safety or security.",
    evidence_summary:
      "Seeded as the alpha fixture candidate: the seed records a report for this version, labelled SAMPLE.",
    license_code: "MIT",
    pricing_model: "purchase",
  }),
  Object.freeze({
    id: "clai0002-2d3e-4f4a-9b5c-d2e3f4a5b6c7",
    listing_version_id: SEED_BETA_VERSION_ID,
    claim: "Records the handling each queued order note needs as a structured queue entry.",
    limitation:
      "The recorded output covers the note as it arrived; a note edited afterwards is not read again.",
    evidence_summary:
      "Seeded as the beta fixture candidate: the seed records a report for this version, labelled SAMPLE.",
    license_code: "Apache-2.0",
    pricing_model: "rent",
  }),
  Object.freeze({
    id: "clai0003-3e4f-4a5b-8c6d-e3f4a5b6c7d8",
    listing_version_id: SEED_GAMMA_VERSION_ID,
    claim: "Prepares a structured handover note naming the depot that takes the order on.",
    limitation:
      "A handover note describes what the records already state; it reserves no bay and no slot.",
    evidence_summary:
      "Seeded as the gamma fixture candidate: the seed records a report for this version, labelled SAMPLE.",
    license_code: "BSD-3-Clause",
    pricing_model: "license",
  }),
  Object.freeze({
    id: "clai0004-4f5a-4b6c-9d7e-f4a5b6c7d8e9",
    listing_version_id: VERSION_DEPOT_ROUTE_PLANNER_ID,
    claim: "Plans each depot-to-depot leg and records it with the distance the leg covers.",
    limitation: "Records a planned route only: it tracks no vehicle and reads no live position.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "MIT",
    pricing_model: "subscription",
  }),
  Object.freeze({
    id: "clai0005-5a6b-4c7d-8e8f-a5b6c7d8e9f1",
    listing_version_id: VERSION_DEPOT_LOAD_ID,
    claim: "Records a bay assignment for each inbound load of the day.",
    limitation:
      "Assigned from the loads it was given: it weighs no load and checks no bay's capacity.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "Apache-2.0",
    pricing_model: "purchase",
  }),
  Object.freeze({
    id: "clai0006-6b7c-4d8e-9f9a-b6c7d8e9f1a2",
    listing_version_id: VERSION_DEPOT_HANDOVER_ID,
    claim: "Records the bay and the team that take an order at a depot handover.",
    limitation:
      "Records the handover it was told about; it does not confirm that the team received the order.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "BSD-3-Clause",
    pricing_model: "rent",
  }),
  Object.freeze({
    id: "clai0007-7c8d-4e9f-8a1b-c7d8e9f1a2b3",
    listing_version_id: VERSION_LEDGER_KEEPER_FIRST_ID,
    claim: "Keeps a running record of order states and records each change with the depot that reported it.",
    limitation: "Records only the changes it is handed; it reconciles nothing against another record.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "MIT",
    pricing_model: "license",
  }),
  Object.freeze({
    id: "clai0008-8d9e-4f1a-9b2c-d8e9f1a2b3c4",
    listing_version_id: VERSION_RECORD_INDEX_ID,
    claim: "Indexes order records so a later lookup finds them by depot and by the day they were opened.",
    limitation: "Indexes by depot and by day alone: a lookup by any other field reads no index.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "Apache-2.0",
    pricing_model: "subscription",
  }),
  Object.freeze({
    id: "clai0009-9e1f-4a2b-8c3d-e9f1a2b3c4d5",
    listing_version_id: VERSION_ARCHIVE_SUMMARY_FIRST_ID,
    claim: "Summarises a closed order's records and records the summary beside them.",
    limitation: "The summary restates the records it read and adds no fact that is not in them.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "BSD-3-Clause",
    pricing_model: "purchase",
  }),
  Object.freeze({
    id: "clai0010-1f2a-4b3c-9d4e-f1a2b3c4d5e6",
    listing_version_id: VERSION_NOTICE_DRAFTER_ID,
    claim: "Drafts a short notice about an order's recorded state.",
    limitation:
      "Drafts a notice only: nothing here sends one, and no field of it names a recipient.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "MIT",
    pricing_model: "rent",
  }),
  Object.freeze({
    id: "clai0011-2a3b-4c4d-8e5f-a2b3c4d5e6f7",
    listing_version_id: VERSION_NOTICE_REVIEW_ID,
    claim: "Drafts a notice and records the points a reviewer should check before it is sent.",
    limitation:
      "The recorded points are prompts to a reviewer, not a check the version performs itself.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "Apache-2.0",
    pricing_model: "license",
  }),
  Object.freeze({
    id: "clai0012-3b4c-4d5e-9f6a-b3c4d5e6f7a8",
    listing_version_id: VERSION_NOTICE_COMPOSER_ID,
    claim: "Composes a notice from an order's own records and records the fields it left unstated.",
    limitation: "Composes from the records it was given; it fills no field from outside them.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "BSD-3-Clause",
    pricing_model: "subscription",
  }),
  Object.freeze({
    id: "clai0013-4c5d-4e6f-8a7b-c4d5e6f7a8b9",
    listing_version_id: VERSION_LEDGER_KEEPER_SECOND_ID,
    claim: "Records the reason for a state change beside the change itself.",
    limitation: "The reason is the one reported to it and is verified against no other record.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "MIT",
    pricing_model: "license",
  }),
  Object.freeze({
    id: "clai0014-5d6e-4f7a-9b8c-d5e6f7a8b9c1",
    listing_version_id: VERSION_ARCHIVE_SUMMARY_SECOND_ID,
    claim: "Records which fields a closing summary left unstated rather than leaving them blank.",
    limitation: "Records the absence of a field; it does not obtain the missing value.",
    evidence_summary: "No report is recorded for this version yet.",
    license_code: "BSD-3-Clause",
    pricing_model: "purchase",
  }),
]);

/** The `threads.id` of the seeded discussion thread about how a standard proposal is reviewed. */
const THREAD_STANDARD_REVIEW_ID = "thrd0001-1d2e-4a3b-8c4d-e1f2a3b4c5d6";

/** The `threads.id` of the seeded discussion thread about comparing two listings. */
const THREAD_BUYER_COMPARISON_ID = "thrd0002-2e3f-4b4c-9d5e-f2a3b4c5d6e7";

/**
 * The two seeded discussion threads: one about the standard's proposal route, started by the
 * contributor account, and one about comparing listings, started by the buyer account.
 *
 * Any resolved demo account may start a thread, so the board is a contribution surface rather than
 * a buyer-only one; two threads with different authors are enough for the board to open with
 * something to read rather than an empty state.
 */
export const SEED_THREADS: readonly Thread[] = Object.freeze([
  Object.freeze({
    id: THREAD_STANDARD_REVIEW_ID,
    title: "How a standard proposal is reviewed",
    author_account_id: SEED_CONTRIBUTOR_ACCOUNT_ID,
    created_at: "2024-03-15T09:00:00.000Z",
  }),
  Object.freeze({
    id: THREAD_BUYER_COMPARISON_ID,
    title: "Comparing two listings side by side",
    author_account_id: SEED_BUYER_ACCOUNT_ID,
    created_at: "2024-03-16T09:00:00.000Z",
  }),
]);

/**
 * Three seeded replies across the two threads, written by two different accounts: the contributor
 * and the developer on the standards thread, the buyer on the comparison thread.
 *
 * A post is append-only by route design — no route rewrites one — which is why none of these rows
 * carries a modification instant.
 */
export const SEED_THREAD_POSTS: readonly ThreadPost[] = Object.freeze([
  Object.freeze({
    id: "post0001-1e2f-4c3d-8e4f-a1b2c3d4e5f6",
    thread_id: THREAD_STANDARD_REVIEW_ID,
    author_account_id: SEED_CONTRIBUTOR_ACCOUNT_ID,
    body: "A proposal starts as submitted and only a review moves it, so the reasoning stays as it was written.",
    created_at: "2024-03-15T10:00:00.000Z",
  }),
  Object.freeze({
    id: "post0002-2f3a-4d4e-9f5a-b2c3d4e5f6a7",
    thread_id: THREAD_STANDARD_REVIEW_ID,
    author_account_id: SEED_DEVELOPER_ACCOUNT_ID,
    body: "The pass thresholds are versioned data, so a change to them is a new standard version rather than an edit of this one.",
    created_at: "2024-03-15T11:00:00.000Z",
  }),
  Object.freeze({
    id: "post0003-3a4b-4e5f-8a6b-c3d4e5f6a7b8",
    thread_id: THREAD_BUYER_COMPARISON_ID,
    author_account_id: SEED_BUYER_ACCOUNT_ID,
    body: "The compare view sets each listing's claims beside the report for its latest version, which is the part I read first.",
    created_at: "2024-03-16T10:00:00.000Z",
  }),
]);

/** The `challenges.id` of the seeded challenge that no one has answered yet. */
const CHALLENGE_OPEN_ID = "chal0001-1c2d-4a3b-8c4d-e5f6a7b8c9da";

/** The `challenges.id` of the seeded challenge the developer answered. */
const CHALLENGE_RESPONDED_ID = "chal0002-2d3e-4b4c-9d5e-f6a7b8c9dae1";

/**
 * The two seeded challenges, one per board state: an `open` challenge raised by the first buyer and
 * a `responded` challenge raised by the second.
 *
 * Both are against a listing whose only version is one of the three fixture candidates, so a
 * challenge and the measured evidence for the version it asks about are both reachable from seeded
 * data. The status is the single column a response moves; the question text is never rewritten.
 */
export const SEED_CHALLENGES: readonly Challenge[] = Object.freeze([
  Object.freeze({
    id: CHALLENGE_OPEN_ID,
    listing_id: SEED_LISTING_INTAKE_QUEUE_ID,
    buyer_account_id: SEED_BUYER_ACCOUNT_ID,
    question:
      "The recorded handling for a queued note: does it cover a note that was edited after it was queued?",
    status: "open",
    created_at: "2024-03-17T09:00:00.000Z",
  }),
  Object.freeze({
    id: CHALLENGE_RESPONDED_ID,
    listing_id: SEED_LISTING_INTAKE_HANDOVER_ID,
    buyer_account_id: SEED_SECOND_BUYER_ACCOUNT_ID,
    question: "Which depot does the handover note name when two depots are on the route?",
    status: "responded",
    created_at: "2024-03-18T09:00:00.000Z",
  }),
]);

/**
 * The single seeded answer, replying to the `responded` challenge on behalf of the developer that
 * owns the listing.
 *
 * The `open` challenge deliberately has no row here: that is what makes the two board states
 * honest, and a seeded answer to it would leave the board claiming a question was answered twice.
 * A response is append-only by route design, so there is no row to edit afterwards.
 */
export const SEED_CHALLENGE_RESPONSES: readonly ChallengeResponse[] = Object.freeze([
  Object.freeze({
    id: "resp0001-3e4f-4c5d-8e6f-a7b8c9dae1f2",
    challenge_id: CHALLENGE_RESPONDED_ID,
    account_id: SEED_DEVELOPER_ACCOUNT_ID,
    body: "It names the depot that takes the order on, which is where the handover note itself is recorded.",
    created_at: "2024-03-18T11:00:00.000Z",
  }),
]);

/**
 * The one standard of this release: `SGI-SO-1.0.0`, Structured Output Conformance.
 *
 * `id` and `code` deliberately hold the same value, because both lookup paths resolve against it:
 * the standards routes accept either the catalogue row's id or the code people quote, so making
 * the two equal is what lets `GET /standards/{id}/versions/{v}` be answered with the label itself.
 *
 * The `summary` keeps the closed vocabulary: the standard compares recorded outputs against a fixed
 * fixture set, and it certifies nothing beyond that.
 *
 * The `standard_versions` row of this standard is **not** here. It holds the versioned thresholds
 * the evaluator reads — twenty cases, five of them critical, at least eighteen matches and no
 * critical failure — and `apps/api/src/seed/seed-database.ts` writes it through
 * `registerStandardVersion` from the standard definition in `@adem/sgi-core`, so the pass rule has
 * one runtime authority rather than a hand-written row.
 */
export const SEED_STANDARD: Standard = Object.freeze({
  id: "SGI-SO-1.0.0",
  code: "SGI-SO-1.0.0",
  title: "Structured Output Conformance",
  summary:
    "Compares the recorded outputs of a declarative candidate submission against a fixed twenty-case fixture set and reports a reproducible PASS or FAIL. The evidence is limited to structured output on the fixture set only, and no outcome certifies an implementation.",
});

/**
 * The two sponsored slots of the limited advertising demonstration: one for the home page and one
 * for the listings page, one per value of the closed placement vocabulary.
 *
 * Both rows are held apart from every SGI table and are joined by no SGI query, which is why a
 * sponsorship cannot influence an evaluation, a badge or the organic order of a listing. Each
 * carries a fictional sponsor label and an integer fee in whole minor units of the synthetic `DEMO`
 * currency; the fee is what makes the item advertising and stops there — no ledger entry is written
 * from it and it is never eligible for the founder allocation. A slot holds nothing about a reader:
 * no identifier and no count of anything seen or opened.
 */
export const SEED_SPONSORED_SLOTS: readonly SponsoredSlot[] = Object.freeze([
  Object.freeze({
    id: "spon0001-4a3b-9c2d-8e1f-a1b2c3d4e5f6",
    sponsor_label: "Carton Collective",
    placement_key: "home",
    fee_minor_units: 2500,
    created_at: "2024-03-19T09:00:00.000Z",
  }),
  Object.freeze({
    id: "spon0002-5b4c-9d3e-8f2a-c3d4e5f6a7b8",
    sponsor_label: "Ledger Lane",
    placement_key: "listings",
    fee_minor_units: 4000,
    created_at: "2024-03-19T10:00:00.000Z",
  }),
]);

/**
 * One seeded fixture candidate: the three identifiers that tie the fixture pack's recording to a
 * version row, and the recorded outputs that differ from the case set's expected outputs.
 *
 * A descriptor holds **deltas and never a copy**. Every case it does not name is submitted with the
 * case set's own `expected_output`, which the seed reads from `@adem/sgi-core`'s case set at seed
 * time; the fixture pack stays the single source of the expected data, and the three deltas below
 * are the only values this file states twice. Where a delta and
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/expected-outcomes.json` ever disagree, the fixture
 * pack is authoritative and the delta here is the defect.
 *
 * The three descriptors encode exactly three paths to the three outcomes the seed must produce:
 *
 * - `seed-alpha` passes with 20 of 20 cases matched, no critical failure and no failing case id.
 * - `seed-beta` fails with 19 matched, one critical failure and `["so-003"]` failing.
 * - `seed-gamma` fails with 17 matched, no critical failure and `["so-014", "so-016", "so-018"]`
 *   failing.
 *
 * `apps/api/test/integration/api-contract.test.ts` asserts all three sets of numbers, so a delta
 * edited here changes an assertion there and the two are read together.
 */
export interface SeedCandidateDescriptor {
  /** `seed-alpha`, `seed-beta` or `seed-gamma`. */
  readonly candidateId: string;
  /** The fixed UUID of the version, matching the fixture pack's `candidate_version_id`. */
  readonly candidateVersionId: string;
  /** The `listing_versions.id` row that carries `is_fixture_candidate = true`. */
  readonly versionRowId: string;
  /** The listing the candidate belongs to. */
  readonly listingId: string;
  /** `case_id` → the output that differs from the case set's expected output. Empty for a pass. */
  readonly outputOverrides: Readonly<Record<string, RecordedOutput["output"]>>;
}

/**
 * The three fixture candidates, in the fixed order alpha, beta, gamma.
 *
 * The order is part of the data rather than an accident of reading: the seed evaluates them in this
 * order, and a report's `prior_report_id` is derived from the reports already written for a
 * candidate version, so the order decides which report a first retest links to.
 */
export const SEED_CANDIDATES: readonly SeedCandidateDescriptor[] = Object.freeze([
  Object.freeze({
    candidateId: "seed-alpha",
    candidateVersionId: SEED_ALPHA_VERSION_ID,
    versionRowId: SEED_ALPHA_VERSION_ID,
    listingId: SEED_LISTING_INTAKE_DESK_ID,
    /**
     * The same four keys and values the case set expects for `so-017`, written in a different key
     * order. Comparison is on canonical JSON — property order fixed, insignificant whitespace
     * removed — so this output still matches, and the differing insertion order is the probe that
     * proves it. The key order below is deliberate: it is never sorted, never reordered and never
     * "corrected" to the case set's order.
     */
    outputOverrides: Object.freeze({
      "so-017": Object.freeze({
        status: "closed",
        item_count: 4,
        depot: "north-yard",
        order_id: "demo-order-1017",
      }),
    }),
  }),
  Object.freeze({
    candidateId: "seed-beta",
    candidateVersionId: SEED_BETA_VERSION_ID,
    versionRowId: SEED_BETA_VERSION_ID,
    listingId: SEED_LISTING_INTAKE_QUEUE_ID,
    /**
     * One case, and it is `so-003` — a **critical** case. The recorded status differs in case from
     * the expected `staged`, so no match count can outvote the failure and the outcome is FAIL
     * however many of the other cases match.
     */
    outputOverrides: Object.freeze({
      "so-003": Object.freeze({ order_id: "demo-order-1003", status: "STAGED" }),
    }),
  }),
  Object.freeze({
    candidateId: "seed-gamma",
    candidateVersionId: SEED_GAMMA_VERSION_ID,
    versionRowId: SEED_GAMMA_VERSION_ID,
    listingId: SEED_LISTING_INTAKE_HANDOVER_ID,
    /**
     * Three `standard` cases, no critical one, which is why gamma fails on the match threshold
     * alone: each delta is a difference the comparison must see.
     *
     * - `so-014` records the scan codes in the order the source listed them. Array order is
     *   significant, so the expected sorted order does not match and the case fails.
     * - `so-016` records the note without its diacritic, which is a different string.
     * - `so-018` records the note with a trailing space inside the string value. **The trailing
     *   space is deliberate** — it is the whole difference between this output and the expected
     *   one, so a formatter or editor that strips trailing whitespace would turn the intended
     *   threshold failure into a pass.
     */
    outputOverrides: Object.freeze({
      "so-014": Object.freeze({ scan_codes: Object.freeze(["sc-2200", "sc-1100", "sc-3300"]) }),
      "so-016": Object.freeze({ order_id: "demo-order-1016", note: "entreposer a l'abri" }),
      "so-018": Object.freeze({ order_id: "demo-order-1018", note: "pending review " }),
    }),
  }),
]);
