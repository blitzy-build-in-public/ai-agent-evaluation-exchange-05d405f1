/**
 * Criterion 7's proof of ADEM's central trust claim: sponsorship and fee data reach no SGI
 * measurement, no badge and no organic ordering. The claim is proved twice, from two directions,
 * because neither direction can see what the other sees.
 *
 * **The static half** walks every import specifier and sponsorship token of `packages/sgi-core/`
 * through the sibling `./boundary-check` and reads the workspace manifests, so an edge that no test
 * exercises is still caught: the import graph is a property of the whole tree rather than of the
 * code paths a suite happens to call. `sgi-core` may import `@adem/shared`, `@adem/sgi-fixtures`
 * and `better-sqlite3` and nothing commercial, and no manifest may declare an edge back into
 * `packages/sgi-core` or into the API workspace.
 *
 * **The behavioural half** captures the three seeded reports, the linked evidence each badge-bearing
 * listing exposes for its newest version, and the organic result payload; then varies sponsorship —
 * slots added through the harness's own handle, because this table is not one of the nine append-only
 * tables and no route writes it — and fee data, through one simulated checkout that is itself a
 * legitimate product write; then re-reads all three and asserts they are byte-identical. Where the
 * static check holds for code paths no test runs, this half holds for data flow the import graph
 * cannot see.
 *
 * **The gate-fee half** closes the same claim on the commercial side: a gate-evaluation fee is
 * journalled in the gate-fee ledger alone, is charged per completed evaluation whether the outcome is
 * `PASS` or `FAIL`, and produces no founder-participation allocation. That is asserted for every
 * seeded report and for a report this suite writes itself, beside the allocation a simulated
 * marketplace transaction does produce.
 *
 * **What this suite is not.** Neither half is a security boundary, a certification or a guarantee.
 * The static half reads text and resolves no package specifier to its sources; the behavioural half
 * compares the payloads of the routes it calls, over the data it varies. Both are stated as the plan
 * states them — as evidence that the delivered tree holds the separation, never as proof that no
 * future change could break it.
 *
 * **The comparison discipline.** All three payload comparisons are claims of byte-identity, so both
 * sides are compared as the product's own canonical JSON text rather than as parsed object graphs: a
 * reordering of the organic results is one of the three things the criterion protects, and an
 * equality assertion over two parsed objects would not observe it.
 *
 * **Its footprint.** Nothing is written to disk, no second connection is opened — the harness's
 * in-memory handle is the only one — and no seeded row is modified. The only writes are the two
 * additive `sponsored_slots` rows and the simulated checkout, which appends to its own tables. No
 * identifier is hard-coded: seeded reports, candidate versions and accounts all come from the
 * harness's accessors.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_COMMERCE_CONFIG } from "@adem/commerce-sim";
import { canonicalize } from "@adem/sgi-core";
import {
  BADGE_SCOPE,
  REPORT_LABEL_SAMPLE,
  REPORT_LABELS,
  REPORT_OUTCOMES,
  SPONSORED_LABEL,
  SPONSORED_PLACEMENT_KEYS,
  SYNTHETIC_CURRENCY_LABEL,
} from "@adem/shared";
import type {
  EvaluationReportDetail,
  EvaluationSubmission,
  ListingDetail,
  ListingSearchResult,
  ReportLabel,
  ReportOutcome,
  SponsoredPlacementKey,
  SponsoredSlotListResult,
  Transaction,
} from "@adem/shared";

import { checkSgiCoreImports, checkWorkspaceManifests, runBoundaryChecks } from "./boundary-check";
import type { BoundaryViolation } from "./boundary-check";
import { startTestServer } from "./test-server";
import type { TestServer } from "./test-server";

/**
 * The three fixture candidates the seed scores and records a report for, in the seed's own order.
 * They are named here rather than imported because the harness's accessors take a candidate
 * identifier, and the vocabulary is closed to these three: `apps/api/src/seed/seed-data.ts` seeds
 * one version and one report for each and no route creates a fourth.
 */
const SEED_CANDIDATE_IDS = ["seed-alpha", "seed-beta", "seed-gamma"] as const;

/** One candidate of {@link SEED_CANDIDATE_IDS}. */
type SeedCandidate = (typeof SEED_CANDIDATE_IDS)[number];

/**
 * The four provenance keys a listing's linked-evidence block carries, which is the whole of what an
 * evidence link states. The badge's scope string is deliberately not among them: it is the shared
 * copy constant {@link BADGE_SCOPE}, which the badge component reads for itself, so a payload that
 * carried it would be a second copy of one sentence.
 */
const EVIDENCE_BLOCK_KEYS = ["report_id", "outcome", "standard_version_id", "label"] as const;

/**
 * The linked-evidence block a listing's detail payload exposes for its newest version: the report
 * the version's measurement is recorded in, and the provenance a badge beside the listing reads.
 */
interface EvidenceBlock {
  /** The report the evidence links to, which the public report read answers for. */
  readonly report_id: string;

  /** The outcome that report states: `PASS` or `FAIL`. */
  readonly outcome: ReportOutcome | null;

  /** The standard version that report was scored against. */
  readonly standard_version_id: string | null;

  /** The report's label, from the closed two-value vocabulary, stating where the run came from. */
  readonly label: ReportLabel | null;
}

/**
 * The six keys one item of the public sponsored collection carries, and nothing else.
 *
 * The five stored columns plus the emitted `sponsored` marker are the whole shape, so an assertion
 * over this set is what refuses a collection that grew a reader identifier, a count of times an item
 * was seen or opened, or any other record of a reader: a sponsored item is labelled, never measured.
 */
const SPONSORED_ITEM_KEYS = [
  "created_at",
  "fee_minor_units",
  "id",
  "placement_key",
  "sponsor_label",
  "sponsored",
] as const;

/**
 * The one insert path into `sponsored_slots`, stated as the table's own five columns.
 *
 * A direct insert through the harness's handle is the only way to vary sponsorship: no route creates,
 * changes or removes a slot, and this table is not one of the nine append-only tables, so it is not
 * guarded by a trigger either. The seeded rows are left exactly as the seed wrote them.
 */
const INSERT_SPONSORED_SLOT_SQL =
  "INSERT INTO sponsored_slots (id, sponsor_label, placement_key, fee_minor_units, created_at) " +
  "VALUES (?, ?, ?, ?, ?)";

/**
 * The two slots this suite adds, each with a label the seed does not use and a fee distinct from the
 * seeded pair, so the collection's answer after the variance is attributable to the variance.
 *
 * The labels are fictional demo content, on the terms every seeded row follows: no real brand, no
 * real person and no contact detail appears in this repository.
 */
const ADDED_SLOTS = [
  { sponsorLabel: "Demo Waybill Bureau", feeMinorUnits: 1700, placementIndex: 0 },
  { sponsorLabel: "Demo Notice Workshop", feeMinorUnits: 3300, placementIndex: 1 },
] as const;

/** One `ledger_entries` row, as the two reads below select it. */
interface LedgerRow {
  /** The ledger the row belongs to: `marketplace`, `gate_fees` or `founder_allocation`. */
  readonly ledger: string;

  /** What the row records: a `charge`, an `allocation` or a `reversal`. */
  readonly entry_type: string;

  /** The amount, as a whole number of minor units of the synthetic currency. */
  readonly amount_minor_units: number;

  /** The transaction the row references, or an explicit `null` for a gate-fee entry. */
  readonly transaction_id: string | null;

  /** The report the row references, or an explicit `null` for a marketplace entry. */
  readonly report_id: string | null;
}

/** The harness every case of this suite runs against: one server over one in-memory database. */
let server: TestServer;

/** The seeded report identifier of each candidate, in candidate order. */
const seededReportIds: string[] = [];

/** Each seeded report's outcome, keyed by report identifier. */
const seededReportOutcomes = new Map<string, string>();

/** Each seeded report's canonical payload, captured before anything varies. */
const seededReportPayloads = new Map<string, string>();

/** The seeded listings whose newest version links a report, in the organic order captured. */
const badgeListingIds: string[] = [];

/** Each badge-bearing listing's canonical evidence block, captured before anything varies. */
const evidenceBlocks = new Map<string, string>();

/**
 * The canonical organic result payload, captured before anything varies and absent until the capture
 * case records it: an absent value can only mean that case did not run, so a later case reads it
 * through {@link recorded} rather than against an initialiser nothing recorded.
 */
let organicPayload: string | undefined;

/**
 * The identifiers of the organic result page, in the order the page returned them, and absent until
 * the capture case records them: an absent value can only mean that case did not run.
 */
let organicOrder: readonly string[] | undefined;

/**
 * How many items the sponsored collection held before anything was added, and absent until the
 * capture case records it: an absent value can only mean that case did not run, and stays distinct
 * from a legitimately captured count of `0`.
 */
let sponsoredItemCount: number | undefined;

/** The identifiers of the slots this suite added. */
const addedSlotIds: string[] = [];

/** The transaction the simulated checkout wrote, or `null` before that case has run. */
let transaction: Transaction | null = null;

/** The reports this suite wrote itself, in the order they were written. */
const writtenReportIds: string[] = [];

/**
 * Every violation as one line naming its file, line and specifier, so a red run says what broke the
 * rule rather than how many things did.
 */
function forbiddenEdgeReport(violations: readonly BoundaryViolation[]): string {
  const lines = violations.map(
    (violation) =>
      `  ${violation.file}:${violation.line} [${violation.rule}] ${violation.specifier}`,
  );

  return `forbidden edges found:\n${lines.join("\n")}`;
}

/**
 * The product's own canonical JSON text of a payload.
 *
 * The canonicaliser is `@adem/sgi-core`'s, so both sides of every comparison are rendered by the same
 * byte-stable producer the evaluator compares recorded output with: one JSON value has one text on
 * any machine, in any locale, on any run. The parameter is typed `unknown` and asserted into the
 * canonicaliser's own parameter type because a payload read off the wire is an untyped JSON value by
 * construction — the assertion adds no member and changes no value.
 */
function canonicalText(value: unknown): string {
  return canonicalize(value as Parameters<typeof canonicalize>[0]);
}

/**
 * The placement key at one position of the closed placement vocabulary, refusing a position the
 * vocabulary does not hold so that no index read is left un-narrowed.
 */
function placementKeyAt(index: number): SponsoredPlacementKey {
  const key = SPONSORED_PLACEMENT_KEYS[index];

  if (key === undefined) {
    throw new Error(`the placement vocabulary holds no position ${index}.`);
  }

  return key;
}

/**
 * The value captured for a key, refusing a key the capture case never recorded — which can only mean
 * the capture case did not run, and is worth saying plainly rather than through a `undefined`.
 */
function capturedFrom(before: ReadonlyMap<string, string>, key: string, what: string): string {
  const value = before.get(key);

  if (value === undefined) {
    throw new Error(`this suite captured no ${what} for "${key}".`);
  }

  return value;
}

/**
 * The value the capture case recorded, refusing an absent one and saying why it is absent — which can
 * only be that the capture case did not run, and is worth stating plainly rather than leaving a later
 * case to fail against an initialiser nothing recorded.
 *
 * Absence is held apart from every recorded value deliberately: a recorded count may be `0`, a
 * recorded ordering may be empty, and a recorded payload is a JSON text rather than `undefined`, so
 * the absent state can never be mistaken for something the capture case observed. It is
 * {@link capturedFrom}'s counterpart for the three values that travel alone rather than in a map
 * keyed by a report or a listing identifier.
 */
function recorded<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`this suite captured no ${what}, so the capture case did not run.`);
  }

  return value;
}

/** One report as the public read answers it. */
async function readReport(reportId: string): Promise<EvaluationReportDetail> {
  const response = await server.get(`/evaluations/${reportId}`);

  expect(
    response.status,
    `reading the report "${reportId}" answered ${response.status}: ${response.text}`,
  ).toBe(200);

  return response.json<EvaluationReportDetail>();
}

/** One listing's detail payload. */
async function readListing(listingId: string): Promise<ListingDetail> {
  const response = await server.get(`/listings/${listingId}`);

  expect(
    response.status,
    `reading the listing "${listingId}" answered ${response.status}: ${response.text}`,
  ).toBe(200);

  return response.json<ListingDetail>();
}

/** One page of the organic listing search. */
async function readListings(): Promise<ListingSearchResult> {
  const response = await server.get("/listings");

  expect(response.status, `the listing search answered ${response.status}: ${response.text}`).toBe(
    200,
  );

  return response.json<ListingSearchResult>();
}

/**
 * The public sponsored collection, fetched with **no header at all**: the contract row's role is
 * `public` and it lists no error case, so an absent `X-Demo-Account` header is the ordinary way to
 * read it and a caller's identity is never part of the request.
 */
async function readSponsoredSlots(): Promise<SponsoredSlotListResult> {
  const response = await server.get("/sponsored-slots");

  expect(response.status, `the sponsored read answered ${response.status}: ${response.text}`).toBe(
    200,
  );

  return response.json<SponsoredSlotListResult>();
}

/**
 * The evidence block a listing's detail payload exposes for its newest version, or `null` when that
 * version carries no report.
 *
 * The four values travel together and are `null` together, which is the listing page's
 * `No SGI report yet` state; the block is built member by member so the comparison that follows is
 * over exactly the provenance the payload states and not over the listing around it. The report
 * identifier is narrowed to a string, so a caller reads the report the evidence names without a
 * second absence check.
 */
function evidenceBlockOf(detail: ListingDetail): EvidenceBlock | null {
  if (detail.report_id === null) {
    return null;
  }

  return {
    report_id: detail.report_id,
    outcome: detail.outcome,
    standard_version_id: detail.standard_version_id,
    label: detail.label,
  };
}

/**
 * Adds the two sponsored slots, each with an identifier generated here and an ISO-8601 UTC instant
 * stamped here, because the table declares both columns: no route writes a slot and no column of it
 * defaults.
 */
function insertAddedSlots(): void {
  const insert = server.database.prepare(INSERT_SPONSORED_SLOT_SQL);

  for (const slot of ADDED_SLOTS) {
    const id = randomUUID();

    insert.run(
      id,
      slot.sponsorLabel,
      placementKeyAt(slot.placementIndex),
      slot.feeMinorUnits,
      new Date().toISOString(),
    );

    addedSlotIds.push(id);
  }
}

/**
 * Runs one simulated checkout as the buyer, on the first listing of the organic page and the offer
 * model that listing declares, so the marketplace charge and the founder allocation it produces are
 * reachable without naming a price: no amount is ever sent, because the product prices a checkout
 * from the listing's own offers.
 *
 * It is a legitimate product write — `POST /checkout-simulations` appends to its own tables — and it
 * is the "fee data varied" half of the experiment: a completed marketplace transaction and the
 * allocation computed from it appear while nothing a report, a badge or an ordering query reads is
 * touched.
 */
async function runSimulatedCheckout(): Promise<Transaction> {
  const page = await readListings();
  const listing = page.items[0];

  if (listing === undefined) {
    throw new Error("the seed published no listing for the simulated checkout to act on.");
  }

  const detail = await readListing(listing.id);
  const version = detail.versions[0];

  if (version === undefined) {
    throw new Error(`the listing "${detail.id}" carries no version to check out.`);
  }

  const response = await server.post(
    "/checkout-simulations",
    {
      listing_id: detail.id,
      listing_version_id: version.id,
      offer_model: detail.pricing_model,
    },
    { account: server.accountForRole("buyer") },
  );

  expect(
    response.status,
    `the simulated checkout answered ${response.status}: ${response.text}`,
  ).toBe(201);

  const written = response.json<Transaction>();

  expect(written.simulated, "a simulated transaction must state that it is simulated").toBe(true);
  expect(written.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
  expect(written.disclosure_label).toBe(DEFAULT_COMMERCE_CONFIG.disclosureLabel);
  expect(Number.isInteger(written.amount_minor_units)).toBe(true);

  return written;
}

/**
 * Writes one new report for a seeded candidate, as the developer that owns the version.
 *
 * The submission is built from the seeded report's own per-case evidence: each case's recorded
 * `actual` is parsed back into the JSON value it canonicalises from, so the new report measures the
 * same recording the seed scored. Nothing is executed on that path — the evaluator compares recorded
 * data — and the developer's identity comes from the resolved demo session, never from a body field.
 */
async function writeNewReportFor(candidate: SeedCandidate): Promise<EvaluationReportDetail> {
  const version = server.candidateVersion(candidate);
  const seededReport = await readReport(server.seededReportId(candidate));

  const submission: EvaluationSubmission = {
    candidate_version_id: version.id,
    standard_version_id: seededReport.standard_version_id,
    recorded_outputs: seededReport.case_results.map((caseResult) => ({
      case_id: caseResult.case_id,
      output: JSON.parse(caseResult.actual) as unknown,
    })),
  };

  const response = await server.post("/evaluations", submission, {
    account: server.owningDeveloper(version.listingId),
  });

  expect(
    response.status,
    `writing a report for "${candidate}" answered ${response.status}: ${response.text}`,
  ).toBe(201);

  return response.json<EvaluationReportDetail>();
}

/**
 * Every `ledger_entries` row that references one report — how a gate-evaluation fee is read, since
 * that entry is the only kind of row whose `report_id` is populated. Rows are read in insertion order.
 */
function entriesForReport(reportId: string): LedgerRow[] {
  return server.query<LedgerRow>(
    "SELECT ledger, entry_type, amount_minor_units, transaction_id, report_id " +
      "FROM ledger_entries WHERE report_id = ? ORDER BY rowid ASC",
    reportId,
  );
}

/**
 * Every `ledger_entries` row that references one transaction — the marketplace charge a simulated
 * checkout takes in, the founder allocation computed from it, and any reversal of either. Rows are
 * read in insertion order.
 */
function entriesForTransaction(transactionId: string): LedgerRow[] {
  return server.query<LedgerRow>(
    "SELECT ledger, entry_type, amount_minor_units, transaction_id, report_id " +
      "FROM ledger_entries WHERE transaction_id = ? ORDER BY rowid ASC",
    transactionId,
  );
}

describe("trust separation", () => {
  describe("static boundary", () => {
    it("holds no forbidden edge between the commercial path and the measured one", () => {
      const violations = runBoundaryChecks();

      expect(violations, forbiddenEdgeReport(violations)).toEqual([]);
    });

    it("covers the SGI manifest's own dependency blocks, which a walk of the source cannot see", () => {
      // The manifest half reports on `packages/sgi-core/package.json` alone, while every other
      // workspace may legitimately declare `@adem/commerce-sim`: the API workspace does, by design.
      const violations = checkWorkspaceManifests();

      expect(violations, forbiddenEdgeReport(violations)).toEqual([]);
    });

    it("finds an edge when it is pointed at real code that holds one, so an empty answer means it read", () => {
      // This scan reads repository source and writes nothing, so it is a liveness proof rather than a
      // planted fixture: `apps/api/src` imports `@adem/commerce-sim` by design — `config.ts`,
      // `routes/checkout.ts` and `routes/evaluations.ts` among others do — and a helper that silently
      // answered `[]` for every directory would fail here and nowhere else.
      const apiSources = new URL("../../../../apps/api/src/", import.meta.url);
      const violations = checkSgiCoreImports(apiSources);

      expect(
        violations.length,
        "scanning apps/api/src found nothing at all, so the check is not reading the tree it was pointed at",
      ).toBeGreaterThan(0);

      const commerceEdges = violations.filter(
        (violation) =>
          violation.rule === "sgi-core-imports-commerce-sim" &&
          violation.specifier === "@adem/commerce-sim",
      );

      expect(commerceEdges.length, forbiddenEdgeReport(violations)).toBeGreaterThan(0);
    });

    it("refuses a directory it cannot read rather than reporting it clean", () => {
      const missing = new URL("../../../../packages/sgi-core/no-such-directory/", import.meta.url);

      expect(() => checkSgiCoreImports(missing)).toThrow(/no-such-directory/);
    });
  });

  describe("sponsorship variance", () => {
    it("captures the reports, the linked evidence and the organic ordering before anything varies", async () => {
      const page = await readListings();

      expect(page.items.length).toBeGreaterThan(0);

      organicOrder = page.items.map((item) => item.id);
      organicPayload = canonicalText(page);
      sponsoredItemCount = (await readSponsoredSlots()).items.length;

      for (const candidate of SEED_CANDIDATE_IDS) {
        const reportId = server.seededReportId(candidate);
        const report = await readReport(reportId);

        expect(REPORT_OUTCOMES).toContain(report.outcome);
        expect(REPORT_LABELS).toContain(report.label);
        expect(report.candidate_version_id).toBe(server.candidateVersion(candidate).id);

        seededReportIds.push(reportId);
        seededReportOutcomes.set(reportId, report.outcome);
        seededReportPayloads.set(reportId, canonicalText(report));
      }

      for (const item of page.items) {
        const detail = await readListing(item.id);
        const block = evidenceBlockOf(detail);

        if (block === null) {
          // A version with no report is the `No SGI report yet` state: the four provenance values are
          // `null` together rather than one of them substituted for a missing other.
          expect(detail.outcome).toBeNull();
          expect(detail.standard_version_id).toBeNull();
          expect(detail.label).toBeNull();
          continue;
        }

        const report = await readReport(block.report_id);

        expect(REPORT_OUTCOMES).toContain(block.outcome);
        expect(REPORT_LABELS).toContain(block.label);
        expect(typeof block.standard_version_id).toBe("string");
        // The linked evidence is provenance for the report it names: a badge reads the report's own
        // outcome, standard version and label rather than a second statement of them. Every seeded
        // report measures a fixture candidate, which is the label the plan's rule gives that origin.
        expect(block.outcome).toBe(report.outcome);
        expect(block.standard_version_id).toBe(report.standard_version_id);
        expect(block.label).toBe(report.label);
        expect(report.label).toBe(REPORT_LABEL_SAMPLE);

        const blockText = canonicalText(block);

        // The badge's scope is the shared copy constant, which the badge component reads for itself:
        // the evidence block's keys are the four provenance values alone, and its text carries no
        // second copy of the sentence a badge renders.
        expect(Object.keys(block).sort()).toEqual([...EVIDENCE_BLOCK_KEYS].sort());
        expect(blockText).not.toContain(BADGE_SCOPE);

        badgeListingIds.push(item.id);
        evidenceBlocks.set(item.id, blockText);
      }

      expect(badgeListingIds.length).toBe(SEED_CANDIDATE_IDS.length);
    });

    it("adds sponsored slots and a simulated purchase, and every added slot shows in the labelled collection", async () => {
      insertAddedSlots();
      transaction = await runSimulatedCheckout();

      const slots = await readSponsoredSlots();
      const labels = slots.items.map((item) => item.sponsor_label);
      const ids = new Set(slots.items.map((item) => item.id));
      const expectedLabels = ADDED_SLOTS.map((slot) => slot.sponsorLabel);

      // The variance has to be observable or the comparison that follows proves nothing: the two
      // labels and the two identifiers this suite added are asserted from the constants rather than
      // from the state the insert left behind, so a case whose inserts never reached the table fails
      // here instead of comparing two identical collections.
      expect(addedSlotIds).toHaveLength(ADDED_SLOTS.length);

      for (const label of expectedLabels) {
        expect(labels, `the collection does not carry the added slot "${label}"`).toContain(label);
      }

      for (const id of addedSlotIds) {
        expect(ids.has(id)).toBe(true);
      }

      expect(slots.items.length).toBe(
        recorded(sponsoredItemCount, "sponsored item count") + ADDED_SLOTS.length,
      );

      for (const item of slots.items) {
        expect(
          item.sponsored,
          `every item of the ${SPONSORED_LABEL} collection carries the literal marker, and never a truthy value`,
        ).toBe(true);
        // The five stored columns plus the emitted marker are the whole shape, so nothing about a
        // reader — an identifier, a count of times an item was seen or opened — has a place here.
        expect(Object.keys(item).sort()).toEqual([...SPONSORED_ITEM_KEYS].sort());
      }

      // The collection stands alone: no sponsored identifier and no sponsored label appears anywhere
      // in the organic payload, which is the "never interleaved with organic results" rule.
      const organic = canonicalText(await readListings());

      for (const value of [...ids, ...labels]) {
        expect(
          organic.includes(value),
          `the sponsored value "${value}" appears in the organic results`,
        ).toBe(false);
      }
    });

    it("answers the same reports, the same linked evidence and the same organic order after the variance", async () => {
      for (const reportId of seededReportIds) {
        const report = await readReport(reportId);

        expect(
          canonicalText(report),
          `the report "${reportId}" changed once sponsorship and fee data varied`,
        ).toBe(capturedFrom(seededReportPayloads, reportId, "report payload"));
      }

      for (const listingId of badgeListingIds) {
        const detail = await readListing(listingId);
        const block = evidenceBlockOf(detail);

        expect(
          block,
          `the listing "${listingId}" no longer links the report it linked before the variance`,
        ).not.toBeNull();
        expect(
          canonicalText(block),
          `the linked evidence of the listing "${listingId}" changed once sponsorship and fee data varied`,
        ).toBe(capturedFrom(evidenceBlocks, listingId, "evidence block"));
      }

      const page = await readListings();

      // Byte-identity rather than set equality: the ordering is one of the three things this
      // criterion protects, so the whole organic payload is compared and its order asserted beside it.
      expect(
        canonicalText(page),
        "the organic results changed once sponsorship and fee data varied",
      ).toBe(recorded(organicPayload, "organic result payload"));
      expect(page.items.map((item) => item.id)).toEqual(
        recorded(organicOrder, "organic result ordering"),
      );
    });
  });

  describe("gate-fee eligibility", () => {
    it("journals one fee per seeded report and no allocation beside it, whatever the outcome", () => {
      const outcomes = seededReportIds.map((reportId) =>
        capturedFrom(seededReportOutcomes, reportId, "outcome"),
      );

      // The fee is charged per completed evaluation regardless of outcome, so this evidence must not
      // depend on `PASS` or `FAIL` — and the seeded set covers each, which is asserted here so the
      // rule is applied to a set that holds both.
      expect(outcomes).toContain("PASS");
      expect(outcomes).toContain("FAIL");

      for (const reportId of seededReportIds) {
        const entries = entriesForReport(reportId);
        const fees = entries.filter((entry) => entry.ledger === "gate_fees");
        const fee = fees[0];

        expect(fees).toHaveLength(1);

        if (fee === undefined) {
          throw new Error(`the report "${reportId}" carries no gate-evaluation fee entry.`);
        }

        // The fee row names the report and no transaction, and its amount is the configured flat fee:
        // a charge for a completed evaluation, and nothing else.
        expect(fee.entry_type).toBe("charge");
        expect(fee.report_id).toBe(reportId);
        expect(fee.transaction_id).toBeNull();
        expect(fee.amount_minor_units).toBe(DEFAULT_COMMERCE_CONFIG.gateFeeMinorUnits);

        expect(entries.filter((entry) => entry.ledger === "founder_allocation")).toEqual([]);
      }
    });

    it("journals a fee for a newly written report and no allocation for it, while the purchase allocates", async () => {
      for (const candidate of SEED_CANDIDATE_IDS) {
        const seededReportId = server.seededReportId(candidate);
        const report = await writeNewReportFor(candidate);

        writtenReportIds.push(report.id);

        // A retest appends a report pointing at its predecessor while the predecessor stands
        // unchanged, and the label follows the version's origin alone: a fixture candidate is
        // `SAMPLE` on a `FAIL` exactly as on a `PASS`.
        expect(report.prior_report_id).toBe(seededReportId);
        expect(report.label).toBe(REPORT_LABEL_SAMPLE);
        expect(report.outcome).toBe(capturedFrom(seededReportOutcomes, seededReportId, "outcome"));

        const entries = entriesForReport(report.id);
        const fees = entries.filter((entry) => entry.ledger === "gate_fees");

        expect(fees).toHaveLength(1);
        expect(fees.map((entry) => entry.amount_minor_units)).toEqual([
          DEFAULT_COMMERCE_CONFIG.gateFeeMinorUnits,
        ]);
        expect(entries.filter((entry) => entry.ledger === "founder_allocation")).toEqual([]);
      }

      // Three distinct reports were appended and no identifier was reused.
      expect(new Set(writtenReportIds).size).toBe(SEED_CANDIDATE_IDS.length);

      if (transaction === null) {
        throw new Error("the simulated checkout of the variance case wrote no transaction.");
      }

      const entries = entriesForTransaction(transaction.id);
      const charges = entries.filter((entry) => entry.ledger === "marketplace");
      const allocations = entries.filter((entry) => entry.ledger === "founder_allocation");

      // One table holds both kinds of entry, and that is the point: a completed marketplace
      // transaction allocates from its own charge, while an evaluation produces a fee and no
      // allocation at all — a fee is ineligible by rule, whatever it bought.
      expect(charges.map((entry) => entry.amount_minor_units)).toEqual([
        transaction.amount_minor_units,
      ]);
      expect(charges.every((entry) => entry.report_id === null)).toBe(true);
      expect(allocations).toHaveLength(1);
      expect(allocations[0]?.transaction_id).toBe(transaction.id);
      expect(allocations[0]?.entry_type).toBe("allocation");
    });
  });
});

/** The two cases that bound the suite: one server for every case, closed once at the end. */
beforeAll(async (): Promise<void> => {
  server = await startTestServer();
});

afterAll(async (): Promise<void> => {
  await server.close();
});
