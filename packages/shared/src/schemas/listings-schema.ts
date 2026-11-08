/**
 * JSON Schema request contracts for the exchange's listing surface: the public
 * reads `GET /listings`, `GET /listings/{id}` and `GET /compare`, and the
 * developer's writes `POST /listings` and `POST /listings/{id}/versions`.
 *
 * Every export below is a plain JSON Schema object typing nothing but itself, so
 * Fastify 4 validates it as it stands: the dependency inventory is closed and
 * names no schema library. Each schema object carries exactly one Fastify
 * section key — `querystring`, `params` or `body` — and attaches directly to a
 * route's `schema` option. Where a route needs two sections it spreads the pair
 * itself, as `{ ...listingIdParamsSchema, ...listingVersionCreateBodySchema }`
 * does for `POST /listings/{id}/versions`; this module exports no combined
 * object.
 *
 * Request side only: no response schema appears in this file, and none may be
 * added. The plan fixes JSON-schema *request* validation, and a Fastify response
 * schema would strip and reorder the serialised payload, silently changing the
 * shape `apps/web/src/api-client.ts` and the end-to-end specs assert;
 * `ListingSummary`, `ListingDetail` and `CompareResult` in `../types/listing.ts`
 * describe what these routes answer with, as prose in the contract rather than
 * as a route option.
 *
 * The closed vocabularies are imported rather than re-spelled: `PRICING_MODELS`,
 * `LISTING_SORTS`, `DEFAULT_LISTING_SORT` and the two compare bounds come from
 * `../types/listing.ts`, which is where the stored `CHECK` constraint, the union
 * the code reads and the wire enum are defined once. A local copy of a tuple
 * would be the second definition of a vocabulary whose whole point is that it
 * has exactly one.
 *
 * Data only: nothing here derives a slug, resolves a category, orders a page,
 * decides whether a listing offers an offer model, or judges whether a version
 * string is already taken. Those belong to `apps/api/src/routes/*` and to the
 * domain packages, and a shared schema that reached for any of them would put
 * domain logic in the one package that must stay data-only.
 */

import {
  COMPARE_MAX_IDS,
  COMPARE_MIN_IDS,
  DEFAULT_LISTING_SORT,
  LISTING_SORTS,
  PRICING_MODELS,
} from '../types/listing';

/**
 * Query contract for `GET /listings` (public).
 *
 * The five filters are optional, so an absent one narrows nothing, and `sort`
 * and `page` are the only inputs whose value is resolved. Validation produces
 * `400` for a value that fails `type`, `enum`, `minimum` or `maxLength` — `?page=0`
 * fails `minimum: 1`, `?model=bogus` fails the {@link PRICING_MODELS} enum, and a
 * free-text filter over the ceiling stated below fails `maxLength` — while an empty result is
 * `200` with
 * `items: []` and `total: 0` and is **never an error**: no listing matching a search
 * is an ordinary state, and the listings page renders it with the filters that
 * produced it.
 *
 * The four free-text filters each carry a stated `maxLength`: `q` 200, and
 * `category`, `license` and `standard` 64. A query value reaches work that grows
 * with it — `q` becomes a `LIKE` pattern compared against every listing's title
 * and summary, and each filter is compared with a column for every row the
 * search scans — so a field with no ceiling lets one client make a single read
 * arbitrarily expensive. The numbers are this module's own choice, large enough
 * for the content of that kind (a search phrase, a category slug, a licence code
 * and a standard code) and no larger.
 *
 * **There is deliberately no page-size property, and none may be added.** The
 * size is the fixed `LISTING_PAGE_SIZE` of `../constants` (20), the response
 * reports the requested page, and an accepted `limit`, `size` or `per_page` here
 * would turn the contract's "page size 20" into a convention a client could ask
 * around.
 *
 * Two validator behaviours decide this row's runtime, and both are Fastify's
 * defaults rather than this file's settings:
 *
 * - `useDefaults` fills `sort` from {@link DEFAULT_LISTING_SORT} and `page` from
 *   its own default before the handler runs, so the handler always receives both
 *   resolved values and must not re-default them. The parsed query is
 *   `ListingSearchQuery` in `../types/listing.ts`, whose `sort` and `page` are
 *   required for exactly that reason.
 * - `removeAdditional` means `additionalProperties: false` **removes** an
 *   unexpected query key rather than rejecting it: `?unknown=1` is stripped
 *   before the handler runs and does not produce a `400`. A `400` comes from a
 *   value that fails a constraint, which is what
 *   `apps/api/test/integration/route-walk.test.ts` asserts for this row.
 *
 * `page` is declared `integer` with a lower bound of `1` and no upper bound of its own: the
 * validator coerces the query string to a number, so the parsed query carries a number and
 * no route has to parse one. The upper end of the range is judged in the route rather than
 * by this schema, because what a page too large to answer actually breaks is the offset the
 * handler is about to bind: `apps/api/src/routes/listings.ts` refuses a page the store
 * cannot address with the same `400`, and its sentence names `page` rather than sending the
 * client the one generic sentence a schema rejection earns. A page that is addressable and
 * past the end of the match set is the empty page above, never a refusal. The 1-based page
 * number is the only paging input — there is no offset, no cursor and no page size.
 */
export const listingSearchQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      q: { type: 'string', maxLength: 200 },
      category: { type: 'string', maxLength: 64 },
      license: { type: 'string', maxLength: 64 },
      model: { type: 'string', enum: PRICING_MODELS },
      standard: { type: 'string', maxLength: 64 },
      sort: { type: 'string', enum: LISTING_SORTS, default: DEFAULT_LISTING_SORT },
      page: { type: 'integer', minimum: 1, default: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `GET /listings/{id}` (public) and, spread
 * together with {@link listingVersionCreateBodySchema} by the route, for
 * `POST /listings/{id}/versions` (owning developer).
 *
 * `id` names a **listing** — the row `GET /listings/{id}` serves, that a version
 * belongs to and that an evaluation's candidate version traces back to — not a
 * listing version, a report, a category or an account. Validation produces `400`
 * for a missing or empty `id`; the route resolves the identifier and produces
 * `404` when no listing carries it, which is the contract's "unknown or removed"
 * case.
 *
 * A hidden listing is part of that `404` for a public reader and must stay
 * resolvable for the operator: moderation removes a listing from browse, so the
 * operator's own reads and a later `restore` both have to find it. The status
 * check is the route's, not this schema's — a parameter schema cannot know a
 * row's moderation state.
 *
 * The name is row-specific rather than a shared `idParamsSchema` on purpose:
 * `packages/shared/src/index.ts` re-exports every schema module with `export *`,
 * so one identifier declared in two of them would be a duplicate declaration and
 * a compile error. `./moderation-schema.ts` therefore declares its own
 * `moderationListingIdParamsSchema`, and `./challenges-threads-schema.ts` its
 * own board parameter schemas, each naming the row it addresses.
 */
export const listingIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /listings` (developer).
 *
 * These five fields are the whole listing a developer may write. Two columns a
 * reader might expect are deliberately absent:
 *
 * - **`slug`** is derived server-side at creation, so a client cannot choose a
 *   URL token it does not own. It is deliberately not unique across listings
 *   (`packages/shared/migrations/0002_listings_and_versions.sql`): no route
 *   documents a conflict for a repeated slug, so nothing may read the token as
 *   an identifier.
 * - **`status`** is absent for the same reason: a new listing is `active`, so a
 *   client cannot place itself in a flagged or already-hidden state. Moderation
 *   is the operator's act, through `./moderation-schema.ts`.
 *
 * The owning developer is resolved from the `X-Demo-Account` header and is never
 * a body field. The API holds a request body to this closed object before its
 * validator runs — the check in
 * `apps/api/src/routes/request-body-policy.ts` — so a client that sends `slug`,
 * `status`, `developer_account_id` or `created_at` alongside an otherwise valid
 * body is answered **`400 validation_error`** rather than having those fields
 * removed, and a value of the wrong JSON type for a declared field, `title: 123`
 * for the string below, is answered the same way rather than converted. No handler
 * may rely on reading an undeclared field, and none may take a developer identity
 * from the body.
 *
 * Statuses this row produces or hands on: `400` for a missing or empty `title`,
 * `summary`, `category_id` or `license_code`, for a bounded text field over its
 * stated maximum, or for a `pricing_model` outside {@link PRICING_MODELS} — and
 * for a declared field carrying a value of another JSON type, or for a field this
 * object does not declare, refused by the request-body policy before the handler
 * runs; `401` for a missing or unresolvable demo header; and `403` for a
 * resolvable account whose role is not `developer`. Success is `201` with the
 * created listing. Whether `category_id` names a category that exists is decided
 * elsewhere: this schema constrains the field's shape, and the reference is held
 * by the foreign key to `categories.id` in
 * `packages/shared/migrations/0002_listings_and_versions.sql`, checked by the
 * route against the catalogue rather than restated as a list of ids here.
 *
 * `minLength: 1` on the four required strings is this module's own choice, taken
 * for consistency with the sibling schema modules where the plan states it
 * explicitly. Its effect is that a required string cannot be satisfied by the
 * empty string: `title: ""` is a validation failure rather than a listing with a
 * blank heading.
 *
 * The three free-text fields also carry a stated `maxLength` — `title` 200,
 * `summary` 2000 and `license_code` 64 — because a stored value is carried by
 * every collection read: a summary with no ceiling lets one client inflate every
 * page that lists the listing and lengthen every search pattern its text
 * matches. `category_id` carries none, and must not: it is an identifier
 * resolved against the catalogue rather than text a reader is meant to read. The
 * other three numbers are this module's own choice, large enough for the content
 * of that kind. No content rule beyond membership of an enum is imposed on a
 * listing's text.
 */
export const listingCreateBodySchema = {
  body: {
    type: 'object',
    required: ['title', 'summary', 'category_id', 'license_code', 'pricing_model'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      summary: { type: 'string', minLength: 1, maxLength: 2000 },
      category_id: { type: 'string', minLength: 1 },
      license_code: { type: 'string', minLength: 1, maxLength: 64 },
      pricing_model: { type: 'string', enum: PRICING_MODELS },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /listings/{id}/versions` (owning developer), attached
 * by the route beside {@link listingIdParamsSchema}.
 *
 * The listing comes from the path and the version from the body. Only
 * `version_string` is required: a published version that has nothing to say
 * beyond its own label is an ordinary state, which is why `notes` is optional.
 * It is optional rather than nullable for the reason the row's column is
 * `NOT NULL` — under `exactOptionalPropertyTypes` an omitted key is the only way
 * to say "nothing recorded here", so a caller cannot pass an explicit
 * `undefined` and cannot write a `null` the row would refuse.
 *
 * `notes` carries a stated `maxLength` of 2000, as every free-text field in this
 * folder now does: the notes are served with the version history on every read
 * of the listing, so a field with no ceiling lets one client inflate every
 * payload that carries the version. The number is this module's own choice,
 * large enough for the content of that kind — the notes for one version — and no
 * larger.
 *
 * **The unique `(listing_id, version_string)` pair is the contract's `409`, and
 * the pattern below MUST NOT be grown into a uniqueness rule.** Only the stored
 * pair can tell whether this listing has already published this version, and the
 * pair is enforced by the database constraint in
 * `packages/shared/migrations/0002_listings_and_versions.sql`. The pattern's job
 * is narrower: it rejects characters that would be nonsensical in a version
 * label so a version stays a token rather than free text — at most 32
 * characters, starting with an alphanumeric, then alphanumerics or `._+-` (the
 * shapes `1.0.0`, `2024-05`, `v2_rc1` and `1.0.0-beta.2` all satisfy).
 *
 * Statuses this row produces or hands on: `400` for a missing or empty
 * `version_string`, for one the pattern or `maxLength` rejects, or for a `notes`
 * over its stated maximum; `404` for a listing id no listing carries; `409` for
 * a version string this listing has already published; `401` for a missing or
 * unresolvable demo header; and `403` for a resolvable developer account that
 * does not own the listing.
 *
 * A version is append-only by route design: no route updates or deletes one, so
 * a correction is a new version and an evaluation always names the version that
 * was measured.
 */
export const listingVersionCreateBodySchema = {
  body: {
    type: 'object',
    required: ['version_string'],
    properties: {
      version_string: {
        type: 'string',
        minLength: 1,
        maxLength: 32,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._+-]*$',
      },
      notes: { type: 'string', maxLength: 2000 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * The accepted form of the `ids` parameter of `GET /compare` (public): between
 * {@link COMPARE_MIN_IDS} and {@link COMPARE_MAX_IDS} identifiers joined by the
 * separator the query form uses, as in `?ids=a,b,c`.
 *
 * The quantifier is **built from the two bounds rather than restated**: the
 * first token already counts one identifier, so the group repeats
 * `COMPARE_MIN_IDS - 1` to `COMPARE_MAX_IDS - 1` times, which is `{1,3}` and
 * yields `^[^,]+(,[^,]+){1,3}$`. Deriving it is what keeps the accept-list and
 * the refusal in `apps/api/src/routes/compare.ts` from being two statements of
 * one boundary that can drift apart; the comma is written literally because the
 * joined form `?ids=a,b,c` is fixed by the wire contract, while
 * `COMPARE_ID_SEPARATOR` in `../types/listing.ts` is the route's split token.
 *
 * The anchors are load-bearing: JSON Schema's `pattern` is a search rather than
 * a whole-string match, so without the trailing `$` a five-identifier list would
 * match on its first four and pass validation.
 *
 * It is exported as a **string and not a `RegExp`**: a string is what the
 * `pattern` keyword takes, and a string is what lets the schema's test compile
 * it with `new RegExp(COMPARE_IDS_PATTERN)` and prove the two-to-four bound
 * without a validation engine in the loop.
 */
export const COMPARE_IDS_PATTERN = `^[^,]+(,[^,]+){${COMPARE_MIN_IDS - 1},${COMPARE_MAX_IDS - 1}}$`;

/**
 * Query contract for `GET /compare?ids=a,b,c` (public).
 *
 * `ids` is declared as a **patterned string and not an array**, and that is the
 * one decision in this module a later reader is most likely to "correct" into a
 * bug. Fastify's query parser hands `?ids=a,b,c` to the validator as the single
 * string `"a,b,c"`, and the validator coerces types with `coerceTypes: 'array'`,
 * which does **not** split on a separator. An `ids` declared as
 * `{ type: 'array', items: { type: 'string' } }` would therefore be coerced into
 * a one-item array holding the string `"a,b,c"` — a value that satisfies the
 * declaration and reads as a valid one-identifier request, so the two-to-four
 * bound would never be enforced and an unknown identifier would reach the route
 * as the joined text of every identifier the client asked for.
 *
 * The string-with-{@link COMPARE_IDS_PATTERN} form puts the bound where it can
 * actually be checked: validation answers the contract's `400`, and the split
 * belongs to `apps/api/src/routes/compare.ts`, which splits the parsed string on
 * `COMPARE_ID_SEPARATOR` and answers `404` for an identifier that names no
 * listing. Two ids are the minimum because a comparison of one is a listing
 * read; four are the maximum because that is what a side-by-side table lays out.
 *
 * Statuses: `400` for a missing `ids`, for a single identifier, for more than
 * four, and for the empty token a stray or trailing separator produces; `404`
 * from the route when a named identifier resolves to no listing. Success is
 * `200` with one `CompareEntry` per requested identifier, in the requested
 * order, so a table's columns follow the reader's ordering rather than one the
 * server chose.
 */
export const compareQuerySchema = {
  querystring: {
    type: 'object',
    required: ['ids'],
    properties: {
      ids: { type: 'string', pattern: COMPARE_IDS_PATTERN },
    },
    additionalProperties: false,
  },
} as const;
