# Audit the report page at more viewports

Labels: P0, good-first-issue, milestone M3

## Scope

Criterion 9 is proved by `e2e/a11y.spec.ts`, which audits four pages — the homepage
`apps/web/src/pages/home.tsx`, a listing page `apps/web/src/pages/listing-detail.tsx`, a comparison
`apps/web/src/pages/compare.tsx` and a report `apps/web/src/pages/report.tsx` — under the two
accessibility projects `playwright.config.ts` declares: `a11y-desktop` sets a 1280 px viewport and
`a11y-mobile` sets a 360 px one. Each of the four tests discovers the page it audits from the public
reads (`GET /api/v1/listings` and `GET /api/v1/listings/{id}`), asserts the intended page rendered,
analyses it with axe's default rule set over the whole document, filters the violations on axe's
documented `impact` field so that only `serious` and `critical` fail, and asserts
`document.documentElement.scrollWidth` is no greater than the viewport the running project set. Your
task is to widen the **width set** the audit runs at: the same four pages, the same rule set, the same
impact filter, and one new project per width — a tablet width and a wide-desktop width are the natural
pair, for example 768 px and 1920 px. Add whatever per-width assertion a new width needs in that same
spec, beside the ones already there.

**The width belongs to the project, never to the spec.** `use.viewport` sits on each project in
`playwright.config.ts`, and `baseURL` stays set explicitly in that file because only `webServer.port` —
which this config does not declare — is what Playwright derives a base URL from, so the specs navigate
with relative paths. A spec that resized the page itself would make every project identical and destroy
the proof, which is why the spec reads the width it is running at from `page.viewportSize()` when it
compares.

**A project that no script selects never runs.** `npm run test:a11y` is today
`playwright test --project=a11y-desktop --project=a11y-mobile`, and `npm run test:e2e` is
`playwright test --project=loop`. Name every new accessibility project on the `test:a11y` script in the
root `package.json` — `playwright test --project=a11y-desktop --project=a11y-mobile
--project=<your new projects>` — and leave `test:e2e` selecting only `loop`. Keep the three existing
projects, and what each of them selects, exactly as they are. Because those project names are a
contract with the root manifest, the same change updates the sentence in `CONTRIBUTING.md` that states
the two audited widths, and the pull request says which widths it added.

**Where the data comes from.** Nothing is written down here and nothing is made by hand: the config's
`webServer` starts the built application itself, hands it a fresh run-unique database file through
`webServer.env.ADEM_DB_PATH`, and seeds it, so every audited page is reached over seeded rows — the
twelve listings across four categories and the three candidate reports `apps/api/src/seed/seed-data.ts`
publishes. The port and that database file belong to the configuration, which derives them from
`CLONE_INDEX`, so nothing has to be set to run the suite. Do not make it depend on a network service, a
secret, an environment value of your own or a database someone created by hand, and run `npm run build`
first, because these suites run against the built application.

**What you must not do.** Do not narrow axe's rule set — no disabled rule, no excluded node, no tag
filter and no scoping — because a narrowed rule set quietly changes what the criterion means. Do not
raise the impact filter above `serious`, do not weaken or delete an existing assertion, and do not set a
viewport in the spec. Do not "fix" a violation by loosening the test: a genuine violation is fixed in
the component or the stylesheet that caused it — `apps/web/src/components/**`,
`apps/web/src/styles/tokens.css` and `apps/web/src/styles/app.css` — and described in the pull request,
because a layout that overflows its width is a defect on the page rather than in the check.

**Why the report page matters most.** `apps/web/src/pages/report.tsx` renders the label, the badge, the
standard and candidate version identifiers, the outcome and the totals, the per-case evidence with its
expected, actual and match columns, and a plain-language summary on a `FAIL` — dense content, and dense
content is where reflow breaks first. Its vocabulary is closed: a report carries `SAMPLE` or
`VERIFIED-IN-DEMO` and nothing else, a badge names the standard version, the scope
"structured output on fixture set only" and the report identifier, a `FAIL` report carries no badge,
and nothing on the page states or implies certification, safety or a guaranteed pass.

Read next: `e2e/a11y.spec.ts`, which owns the rule set, the impact filter and the scroll assertion;
`playwright.config.ts` for the three projects and the width each sets; the `impact` field in the
axe-core API documentation (`https://www.deque.com/axe/core-documentation/api-documentation`) for the
two levels that fail a run; `apps/api/src/seed/seed-data.ts` for the rows every audited page is reached
through; `apps/web/src/pages/report.tsx` for the page carrying the densest content; `CONTRIBUTING.md`
for the contribution path and the pull-request checklist; and `docs/ROADMAP.md` for the milestone and
priority tier this belongs to.

## Acceptance

1. `npm run test:a11y` exits 0, and its report names your new project or projects together with the same
   four pages at the width or widths they add.
2. Observable: the filtered violation array is empty on all four pages at every audited width, and each
   page's `document.documentElement.scrollWidth` is no greater than that width — including the report
   page at 360 px, the narrowest audited width and the one the no-horizontal-scroll assertion exists
   for.
3. Prove the gate is live, locally and without committing it: introduce one serious violation on one
   audited page, observe the run fail and name the rule the failure reports, then revert the temporary
   change and observe the run pass again. Record both runs in the pull-request description.
4. `npm run test:e2e` still exits 0 and still runs only the `loop` project's two specs, so the widths
   you added did not change what the end-to-end script selects.
5. `git diff --stat -- e2e/developer-to-buyer.spec.ts e2e/route-walk.spec.ts` prints nothing: the
   end-to-end specs are untouched.
6. `npm run scan:exclusions` exits 0 with an empty finding list, and no file you added holds an
   email-like string or a run of five or more consecutive digits.
