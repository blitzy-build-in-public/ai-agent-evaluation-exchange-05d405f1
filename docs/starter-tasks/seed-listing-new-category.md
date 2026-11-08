# Seed one more listing, with its claim and its version

Labels: P0, good-first-issue, milestone M2

## Scope

A buyer judges a listing by what it **claims** beside what was **measured**, so a listing that is only
a title in a card teaches a reader nothing. `apps/api/src/seed/seed-data.ts` publishes the
demonstration exchange a fresh checkout shows, and your task is to add one more complete listing
inside a category the seed already carries — a listing row, at least one version of it, and the claim
with its limitation that the compare view reads — so the search, filter and compare surfaces have one
more real shape to lay side by side.

You write one coherent set of rows, following the conventions the shipped ones use.

1. **The listing**, in one of the four shipped categories: a stable identifier constant, a slug, a
   fictional title and summary, a licence code and one of the four pricing models - rent, purchase,
   licence or subscription. Use a category the seed already carries rather than inventing one: a new
   category is the separate task in `docs/starter-tasks/listing-category-seam.md`, and it belongs to
   the seam because it is a value the extension registry validates.
2. **Its version**, so the history the developer page shows is not empty. Every version carries a
   version string, notes, a creation instant and the `is_fixture_candidate` flag, which stays `false`
   for a version a developer publishes through the API - it is `true` only for the three candidate
   fixture references, and it is the single input the report's label rule reads, which is why a
   listing you seed does not become a `SAMPLE`-labelled candidate.
3. **Its claim**, one row per version, carrying the claim, the limitation the developer admits, an
   evidence summary, a licence code and a pricing model. The limitation is not decoration: the
   compare view exists to put a claim and its limitation beside the measured evidence, and a claim
   with an empty limitation is a listing nobody can judge.

**Determinism and fiction, both required.** Every value is a fixed literal: no clock, locale,
timezone, random source, environment read or network — a creation instant is written as a fixed
ISO-8601 UTC string, and every count is an integer. Every identity is invented: no real company,
product or person, no contact detail, no credential or token, no `@` in any string and no run of five
or more consecutive digits, because the exclusion scan reads every tracked file and the manual
privacy review reads this folder and the seed. Amounts, where you show one, are integer minor units
of the synthetic currency `DEMO` and carry no real currency code or symbol.

Read next: `apps/api/src/seed/seed-data.ts` for the shipped listing, version and claim rows and the
identifier conventions; `docs/SCHEMA.md` for the `listings`, `listing_versions` and `listing_claims`
tables; `apps/api/src/routes/listings.ts` for the search contract the row must satisfy;
`apps/web/src/components/compare-table.tsx` for how the claim, the limitation and the evidence are
laid out.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:integration -- --testNamePattern="the seed publishes"` exits 0 with the counts it
   asserts updated deliberately in the same change, and
   `--testNamePattern="the standard and the candidates the seed describes"` exits 0 with the three
   seeded outcomes unchanged: a seeded row is a row the contract counts, and leaving the count behind
   is how a seed drifts from what it claims to publish.
3. `npm run seed` exits 0 against a fresh database file, and the listing is observable over the API:
   `GET /api/v1/listings?category=<the category's slug>` answers `200` with your listing, and
   `GET /api/v1/listings/<your id>` answers `200` with its version history, its claim, its limitation
   and the offer models it supports.
4. The compare view works with the new row: `GET /api/v1/compare?ids=<yours>,<another>` answers `200`
   with both entries side by side, and the page renders the claim against the evidence for both rather
   than a blank column. Record the two responses or a screenshot in the pull-request description.
5. The seed's own invariants still hold: `npm run test:integration` exits 0, so every string the seed
   publishes is still free of a contact detail, every closed vocabulary still holds, and the three
   candidate outcomes (`seed-alpha` `PASS`, `seed-beta` failing on its critical case, `seed-gamma`
   failing on its threshold cases) are unchanged.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
