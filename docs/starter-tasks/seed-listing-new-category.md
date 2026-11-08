# Add a seed listing in a new category

Labels: P0, good-first-issue, milestone M2

## Scope

A buyer judges a listing by what it **claims** beside what was **measured**, so a listing that is only a
title in a card teaches a reader nothing - and a category with no listing in it teaches a reader less.
`apps/api/src/seed/seed-data.ts` publishes the demonstration exchange a fresh checkout shows, and your
task is to widen it by one category and one complete listing inside that category: a category row, a
listing row, at least one version of it, and the claim with its limitation the compare view reads. You
write data and nothing else, in the frozen-literal style of the shipped rows.

1. **Your category**, a row in `SEED_CATEGORIES` whose slug satisfies the pattern the extension seam's
   guard `validateListingCategory` in `packages/sgi-core/src/extensions/listing-category.ts` applies -
   `^[a-z][a-z0-9-]{1,31}$`, two to thirty-two lowercase letters, digits or hyphens and starting with a
   letter - with a non-empty name. That guard also requires a non-empty description of the category
   value a contributor registers through the seam; the row stores an id, a slug and a name, so a seeded
   row carries no description.
2. **Its listing**, a row in `SEED_LISTINGS` naming your category's id, with an invented title and
   summary, a licence code, an active status, fixed ISO-8601 `created_at` and `updated_at` literals, and
   a pricing model from the closed set `rent`, `purchase`, `license` or `subscription`. Every row keeps
   the shape the types in `packages/shared/src/index.ts` declare.
3. **Its version and its claim**, rows in `SEED_LISTING_VERSIONS` and `SEED_LISTING_CLAIMS` in the same
   literal style: a version string, notes, a creation instant and `is_fixture_candidate`; and, one row
   per version, the claim, the limitation the developer admits, an evidence summary, a licence code and
   a pricing model. A claim with an empty limitation is a listing nobody can judge.

**The seeding mechanism is not yours to change.** `apps/api/src/seed/seed-database.ts` owns the refusal
of a database that already holds rows, the single transaction that makes the seed all-or-nothing, the
insert-only writes in foreign-key order, the standard version it registers through the scoring package,
and the three reports it derives in the fixed order alpha, beta, gamma. `apps/api/src/seed/run-seed.ts`
stays the `npm run seed` entry that honours `ADEM_DB_PATH` through `apps/api/src/config.ts`. You add rows
to the data file; you never add or reorder a stage of the algorithm.

**The seed's invariants hold.** Exactly three `listing_versions` rows carry the
`is_fixture_candidate` flag as `true` - the three candidate fixture references - so a version you add
carries `false`; that flag together with the outcome is the only input to a report's label (`SAMPLE` for
a fixture candidate, otherwise `VERIFIED-IN-DEMO`). The seed still writes exactly three reports - one
PASS, one failing on a `critical` case, one failing on the match threshold - and they still agree with
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/expected-outcomes.json`. Your row moves no outcome.

**It is data, not schema.** `packages/shared/migrations/` holds applied migrations and each one is
immutable: never edit one, and never add one for a category or a listing. If your listing needs a column
that does not exist, that is a change to the plan rather than a starter task - raise it in the pull
request instead of touching the schema.

**Content rules, spelled out.** Every value is invented, and every value is fixed: no clock, locale,
timezone, random source, environment read or network. No real brand, company, product, personal name,
contact detail, credential or token anywhere in a row; no at-sign inside any string and no run of five
or more consecutive digits, because the exclusion scan reads every tracked file and the manual privacy
review reads this folder and the seed. Nothing in a seeded text claims safety, certification or a
guarantee, and no real currency code or symbol appears anywhere: money, if a row mentions any, is an
integer count of minor units of the synthetic currency `DEMO`.

**If a suite counts the seeded rows, update it in the same change.** A fresh database holds one more
category and one more listing because you added them, so the expectation moves deliberately - update it,
say so in the pull request, and never weaken an assertion to make a run pass.

Read next: `CONTRIBUTING.md` for the contribution path and the pull-request checklist, and
`docs/ROADMAP.md` for the milestone this task belongs to, rather than either being restated here.
`apps/api/src/routes/listings.ts` holds the search contract your row must satisfy, and
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/expected-outcomes.json` holds the outcomes that must not
move.

## Acceptance

1. `npm run seed` exits 0 against a fresh database file, and the summary it prints names the rows it
   wrote, your new category and your new listing among them.
2. `npm run typecheck` exits 0; `npm run test:unit -- packages/sgi-core` exits 0, which includes the seam
   guard's accept case for the slug pattern your category satisfies; and `npm run test:integration`
   exits 0.
3. Observable by hand: after `npm run seed` and `npm start`,
   `GET http://localhost:3000/api/v1/listings?category=<your slug>` answers `200` with your listing in
   `items` - the page size is fixed at 20, and a filter that matches nothing is `200` with `items: []`
   rather than an error - and on `/listings` your category appears in the category filter and selecting
   it returns that listing. Paste the response body into the pull request.
4. The three seeded reports are unchanged: `GET /api/v1/evaluations/{id}` for each still answers PASS,
   the `critical`-case FAIL and the threshold FAIL, and
   `npm run test:integration -- --testNamePattern=evaluations` exits 0.
5. `git diff --stat -- packages/shared/migrations` prints nothing.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
