# Add a listing category through the ListingCategory seam

Labels: P1, good-first-issue, milestone M4

## Scope

A category is how a buyer narrows the exchange, and the third extension seam exists so the set of
them is a contribution rather than a code change: a new category is a value registered through the
exported interface, validated by the same guard the shipped ones pass, and stored as a row the
listings filter reads. Your task is to add one and prove it is a first-class category — filterable,
listable and seeded — rather than a string that happens to work on one page.

You write three things and nothing else.

1. **Your category**, an object satisfying `ListingCategory` as
   `packages/sgi-core/src/extensions/listing-category.ts` declares it: `slug`, `name` and
   `description`. The slug pattern is `^[a-z][a-z0-9-]{1,31}$` — lower-case, starting with a letter,
   hyphens allowed, never a trailing one — and it is the value a listing stores and a search filters
   on, so it is fixed once published. `validateListingCategory` refuses a value whose slug does not
   match the pattern, whose `name` or `description` is not a non-empty string, throwing
   `ListingCategoryValidationError` with the stable code `seam_validation` and the `field` that
   failed.
2. **Its registration**, through `createExtensionRegistry()` from
   `packages/sgi-core/src/extensions/extension-registry.ts`: `registerListingCategory` accepts your
   category and refuses a second registration of a slug it already holds with
   `DuplicateExtensionError`, whose code is `duplicate_extension` and whose kind is
   `listing-category`.
3. **At least one seeded listing that uses it**, in `apps/api/src/seed/seed-data.ts`, so the category
   is not an empty shelf in a fresh checkout. Follow the shape the four shipped categories use: an
   identifier constant, a frozen row in the categories array, and a listing (or more) whose
   `category_id` is that row, with a fictional title, a summary and a pricing model. A seeded listing
   is display data, and no seeded row names a real company, product or person.

**What must not change.** The four shipped categories keep their identifiers, slugs and names,
because seeded listings and the integration suite's assertions reference them; an existing row is
extended by adding a row, never by editing one. The category's vocabulary is the product's, not a
marketplace's: no real brand, company, product or personal name, no contact detail, no `@` in any
string, and no run of five or more consecutive digits — the exclusion scan and the manual privacy
review both read the seed and this briefs folder. Deterministic data too: fixed literals and integer
counts, no clock, locale, random source or environment read.

Read next: `packages/sgi-core/src/extensions/listing-category.ts` and
`packages/sgi-core/src/extensions/extension-registry.ts`;
`apps/api/src/seed/seed-data.ts` for the shipped category rows and a seeded listing;
`apps/api/src/routes/listings.ts` for the filter that reads a category; `docs/SCHEMA.md` for the
`categories` and `listings` tables.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- packages/sgi-core` exits 0 with your own test beside your category asserting,
   rather than describing, the seam's behaviour: a compliant value validates; a slug that starts with
   a digit, is empty, exceeds the length bound or ends in a hyphen throws
   `ListingCategoryValidationError` naming `slug`; a repeated slug throws `DuplicateExtensionError`
   for kind `listing-category`.
3. `npm run test:integration -- --testNamePattern="route walk"` exits 0 and your category is
   observable over the API: `GET /api/v1/listings?category=<your slug>` answers `200` with the
   listing you seeded, and the same query with an unknown slug answers `200` with `items: []` rather
   than an error — an empty result is a state with an explanation, never a failure.
4. `npm run test:integration` exits 0, including the seed contract, which counts the rows a fresh
   database holds: adding a category and a listing means those counts move deliberately, and the
   assertion is updated in the same change rather than left to drift.
5. `npm run seed` exits 0 against a fresh database file, and the new listing renders on the listings
   page with its category filter applied — a page screenshot or the response body in the pull
   request is enough evidence.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
