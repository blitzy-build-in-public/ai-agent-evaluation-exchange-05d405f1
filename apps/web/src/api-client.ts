/**
 * The web workspace's only caller of `/api/v1`: the single HTTP boundary between the
 * public UI and the API.
 *
 * Everything a page needs from the service passes through this module, so no page holds a
 * URL, a header, a fetch call or a knowledge of the wire envelope. Four decisions follow
 * from that and are stated here once.
 *
 * **Base URL.** The path `/api/v1` on the page's own origin, and nothing else. The built
 * UI is served by Fastify alongside the API, and in development Vite proxies `/api` to the
 * local API, so the same relative path works in both. No environment variable, no
 * build-time injected value and no absolute origin is read: the product needs no
 * configuration to run.
 *
 * **The demo account.** Every write carries the `X-Demo-Account` header, whose value is
 * the selected synthetic account, and so do the four operator-only reads, which require
 * one. The public listing read carries it too, but only when an account is selected: a
 * public row has to answer a reader who has selected none, which is why the header is
 * optional there and why this module attaches it rather than refusing. The header is a
 * role selector for a demonstration and never authentication of an identity: it is
 * trivially impersonable by design, which is why the server checks the role on every
 * non-public route and why the label "demo only, no production authentication" is visible
 * wherever the switcher appears. A write attempted with no account selected throws
 * {@link ApiClientError} here, before any request is sent, so the failure reads as an
 * explanation rather than as a bare `401` from the server; a public read never refuses.
 *
 * **One error shape.** Every non-2xx response is parsed as the API's single envelope
 * `{ error: { code, message } }` and raised as {@link ApiClientError}, carrying the status,
 * the code, a sentence and — on a throttled write — the whole seconds `Retry-After`
 * reported. A body that is not that envelope still raises a typed error with the real
 * status and a generic sentence, and no failure ever surfaces a stack trace, a raw body or
 * a URL.
 *
 * **Normalisation.** The shape of a payload is settled here, not in a page: a single
 * response is the entity it created or read, possibly wrapped under one key; a list read
 * is a bare array or an `{ items: [...] }` envelope; and the listing payloads' nullable
 * report fields are `null` rather than absent. A page therefore reads a typed value and
 * never an unpublished field name.
 *
 * This module holds no business rule. It derives no label, no outcome, no count, no amount
 * and no retest link: an evaluation submission carries the candidate version, the standard
 * version and one recorded output per case, and every provenance field — including the
 * label and the prior report a retest points at — arrives from the server. It also
 * validates no server vocabulary it does not have to construct: the API validates every
 * request at its edge and this module sends only what the contract fixes.
 *
 * The one persistence in the workspace is the selected demo account, in a documented
 * `sessionStorage` key behind {@link getSelectedDemoAccountId} and
 * {@link setSelectedDemoAccountId}. Beyond that key there is no cookie, no browser-local
 * storage, no tracking script and no analytics.
 */

import {
  COMPARE_ID_SEPARATOR,
  COMPARE_MAX_IDS,
  COMPARE_MIN_IDS,
  DEMO_ACCOUNT_HEADER,
  LISTING_PAGE_SIZE,
  LISTING_STATUSES,
  PRICING_MODELS,
  PROPOSAL_STATUSES,
  REPORT_LABELS,
  REPORT_OUTCOMES,
  STANDARD_STATUSES,
} from "@adem/shared";
import type {
  Appeal,
  AppealCreateBody,
  AppealRulingBody,
  AuditEvent,
  Category,
  Challenge,
  ChallengeCreateBody,
  ChallengeResponse,
  ChallengeResponseBody,
  CheckoutSimulationBody,
  CompareEntry,
  CompareResult,
  EvaluationReportDetail,
  EvaluationSubmission,
  FounderAllocationLedgerReadResult,
  GovernanceEvent,
  Inquiry,
  InquiryCreateBody,
  LedgerEntry,
  LedgerName,
  LedgerReadResult,
  Listing,
  ListingClaim,
  ListingCreateBody,
  ListingDetail,
  ListingSearchQuery,
  ListingSearchResult,
  ListingStatus,
  ListingSummary,
  ListingVersion,
  ListingVersionCreateBody,
  ModerationAction,
  OfferModel,
  PricingModel,
  Refund,
  RefundCreateBody,
  ReportCaseResult,
  ReportLabel,
  ReportOutcome,
  SponsoredSlotListItem,
  SponsoredSlotListResult,
  Standard,
  StandardProposal,
  StandardProposalCreateBody,
  StandardProposalReviewBody,
  StandardVersion,
  Thread,
  ThreadCreateBody,
  ThreadPost,
  ThreadPostBody,
  Transaction,
} from "@adem/shared";

import { isRecord, readCount, readMember, readString, readText } from "./payload-reading";

/**
 * The versioned prefix every route in this module is reached under. It is the API's own
 * version boundary, relative to the page's origin, and it is the whole of this module's
 * base-URL resolution.
 */
const API_BASE_PATH = "/api/v1";

/**
 * The `sessionStorage` key holding the selected demo account id, and the only persistence
 * in the workspace. It stores one string — the `accounts.id` a write sends in
 * {@link DEMO_ACCOUNT_HEADER} — and it holds nothing else: no cookie, no profile, no
 * preference and no identifier of a person.
 */
export const DEMO_ACCOUNT_STORAGE_KEY = "adem.demo-account-id";

/**
 * The code {@link ApiClientError} carries when no HTTP response was received at all: the
 * request never reached the service, or the connection failed before a reply. It is this
 * module's own code, because the API's closed error vocabulary describes responses and
 * this failure has none, and it exists so a page can tell "the service could not be
 * reached" from "the service refused this request".
 */
export const TRANSPORT_ERROR_CODE = "network_error";

/**
 * The code carried when a response arrived but could not be read as the shape its contract
 * fixes — a success body that is not the entity, a list body carrying no array. It reuses
 * the API's own spelling for a server-side fault because that is what such a response is,
 * while the status stays the one the response actually had.
 */
const UNREADABLE_RESPONSE_CODE = "internal_error";

/** The sentence a write with no demo account selected is refused with. */
const MISSING_DEMO_ACCOUNT_MESSAGE = `Select a demo account before writing: a write carries the ${DEMO_ACCOUNT_HEADER} header naming a synthetic demo account, which separates roles for the demonstration and is not authentication of any identity.`;

/** The sentence a request that received no HTTP response at all is raised with. */
const TRANSPORT_ERROR_MESSAGE = "The service could not be reached, so no request was sent.";

/** The sentence a response whose body is not the shape its contract fixes is raised with. */
const UNREADABLE_RESPONSE_MESSAGE = "The service answered with a response this client could not read.";

/** The sentence used for a client-error response that arrived without the error envelope. */
const CLIENT_ERROR_MESSAGE = "The request could not be completed as sent.";

/** The sentence used for a server-fault response that arrived without the error envelope. */
const SERVER_ERROR_MESSAGE = "The request could not be completed.";

/** The sentence used for a throttled write that arrived without the error envelope. */
const RATE_LIMIT_MESSAGE =
  "This client has sent the maximum number of writes allowed in a minute. Wait, then try again.";

/**
 * The code the API answers each status with, restated because the API workspace cannot be
 * reached from this one. It is consulted only when a failure arrived **without** the
 * error envelope — a body that was not JSON, or JSON that was not the envelope — so a
 * conforming failure always yields the code the server chose.
 *
 * Total over the statuses the API's own vocabulary carries, the two the framework raises
 * before a handler runs included — a body above the route's limit (`413`) and a media type
 * no parser is registered for (`415`) — so a failure that arrived without the envelope is
 * labelled from the status it had rather than as a fault of the service.
 */
const STATUS_FALLBACK_CODES: Readonly<Partial<Record<number, string>>> = Object.freeze({
  400: "validation_error",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
  500: "internal_error",
});

/**
 * The path segment of each ledger's operator read. The ledger vocabulary spells two of its
 * members with an underscore while the route spells them with a hyphen, and mapping the
 * two explicitly is what keeps a URL from being built by rewriting a vocabulary value.
 */
const LEDGER_PATH_SEGMENTS: Readonly<Record<LedgerName, string>> = Object.freeze({
  marketplace: "marketplace",
  gate_fees: "gate-fees",
  founder_allocation: "founder-allocation",
});

/**
 * The one failure this module raises: the status the request was answered with, the stable
 * code the API's envelope carries, a sentence a page can render as it stands, and — on a
 * throttled write — how many whole seconds to wait.
 *
 * A page renders `message` and branches on `code` or `status` where it must; it never
 * inspects a response, a body or a URL, because none of those reaches it. `status` is `0`
 * only for {@link TRANSPORT_ERROR_CODE}, where no response was received at all, and
 * `retryAfterSeconds` is non-null only when the response carried a numeric `Retry-After`,
 * which the write rate limit does.
 *
 * The class carries the four facts the contract fixes and nothing else: no request, no
 * response, no headers and no cause, so a failure cannot leak a URL, a header value or an
 * unread body into a rendered explanation.
 */
export class ApiClientError extends Error {
  /** The HTTP status of the response, or `0` when no response was received. */
  readonly status: number;

  /** The stable error code: the envelope's `code`, or one of this module's own. */
  readonly code: string;

  /** Whole seconds to wait before retrying, or `null` when the response stated none. */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The selected demo account id, held in memory so a page reads it synchronously, and read
 * from `sessionStorage` on first use so the selection survives a reload within the tab.
 * `null` means the key is absent, empty or unreadable — a state that refuses a write here
 * rather than sending one the server would answer `401`.
 */
let selectedDemoAccountId: string | null | undefined;

/** The selected account id, or `null` when none is stored. */
function readStoredDemoAccountId(): string | null {
  try {
    const stored = sessionStorage.getItem(DEMO_ACCOUNT_STORAGE_KEY);
    if (stored === null) {
      return null;
    }
    const trimmed = stored.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    // Storage can be unavailable or refused (a blocked or partitioned context). The
    // selection is then simply not persisted: reading yields `null` and writing still
    // applies in memory for the life of the page.
    return null;
  }
}

/**
 * The `accounts.id` of the selected demo account, or `null` when none is selected.
 *
 * Read from memory, and from the documented `sessionStorage` key on first use. An absent,
 * empty or unreadable stored value yields `null` rather than throwing, so a page can render
 * the switcher's unselected state on any browser.
 */
export function getSelectedDemoAccountId(): string | null {
  if (selectedDemoAccountId === undefined) {
    selectedDemoAccountId = readStoredDemoAccountId();
  }
  return selectedDemoAccountId;
}

/**
 * Selects the demo account every later write is made as, or clears the selection.
 *
 * The value is the `accounts.id` of one of the six synthetic seed accounts; a blank or
 * empty string clears the selection exactly as `null` does. The selection is applied in
 * memory at once and persisted to the documented `sessionStorage` key; when storage is
 * unavailable the in-memory selection still applies and the call is not an error, because
 * refusing to switch accounts would be a worse failure than not remembering the choice.
 */
export function setSelectedDemoAccountId(id: string | null): void {
  const trimmed = typeof id === "string" ? id.trim() : "";
  const next = trimmed === "" ? null : trimmed;
  selectedDemoAccountId = next;
  try {
    if (next === null) {
      sessionStorage.removeItem(DEMO_ACCOUNT_STORAGE_KEY);
    } else {
      sessionStorage.setItem(DEMO_ACCOUNT_STORAGE_KEY, next);
    }
  } catch {
    // See `readStoredDemoAccountId`: an unavailable or refused store leaves the in-memory
    // selection as the effective one.
  }
}

/**
 * The selected account id, or a typed refusal when none is selected.
 *
 * This is what makes a write without an account read as an explanation: the request is
 * never sent, and the raised error carries the `401` and the `unauthorized` code the route
 * itself would have answered it with.
 */
function requireDemoAccountId(): string {
  const accountId = getSelectedDemoAccountId();
  if (accountId === null) {
    throw new ApiClientError(401, "unauthorized", MISSING_DEMO_ACCOUNT_MESSAGE);
  }
  return accountId;
}

/**
 * What a call in this module works with before normalisation: the response's status and
 * its parsed body, or `null` when the body was empty or was not JSON.
 */
interface ApiResponse {
  /** The HTTP status the service answered with. */
  readonly status: number;
  /** The parsed JSON body, or `null` when there was no body to parse. */
  readonly payload: unknown;
}

/** The method of a contract row. Every row this module calls is one of the two. */
type HttpMethod = "GET" | "POST";

/**
 * The parts of a request that vary: a read's query, a write's body, whether the row is
 * non-public and therefore requires the demo account header, and whether the row is the
 * public read that may be asked as the resolved demo account.
 *
 * Each key is omitted rather than passed as `undefined`, so `exactOptionalPropertyTypes`
 * makes every call site state which of the four applies.
 */
interface SendOptions {
  /** The serialised query of a read; omitted by every write. */
  readonly query?: URLSearchParams;
  /** The request body of a write; omitted by every read. */
  readonly body?: unknown;
  /** Whether the route requires the demo account header: every write, and four reads. */
  readonly demoAccount?: boolean;
  /**
   * Whether the row is the public read asked as the resolved demo account: the header is
   * attached when one is selected and omitted when none is, because a public row must
   * still answer a reader who has selected no account.
   */
  readonly optionalDemoAccount?: boolean;
}

/**
 * Sends one request and resolves with its status and parsed body.
 *
 * The request is built here and nowhere else: the versioned base path, the `accept` header,
 * the JSON content type on a write, and the demo account header. A route that requires the
 * header takes its value from {@link requireDemoAccountId}, so such a request is refused
 * here before anything is sent rather than answered by the server; the public read that
 * {@link SendOptions.optionalDemoAccount} names takes it from
 * {@link getSelectedDemoAccountId} and carries it only when an account is selected, since
 * a public row is read by visitors who have selected none.
 *
 * Two failures are raised as {@link ApiClientError} and neither escapes as anything else: a
 * request that received no response at all, carrying {@link TRANSPORT_ERROR_CODE} and
 * status `0`, and a non-2xx response, carrying its own status, its envelope's code and
 * sentence, and the `Retry-After` seconds it stated. A 2xx resolves, whatever its body.
 */
async function send(method: HttpMethod, path: string, options: SendOptions = {}): Promise<ApiResponse> {
  const query = options.query === undefined ? "" : `?${options.query.toString()}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.demoAccount === true) {
    headers[DEMO_ACCOUNT_HEADER] = requireDemoAccountId();
  } else if (options.optionalDemoAccount === true) {
    const accountId = getSelectedDemoAccountId();
    if (accountId !== null) {
      headers[DEMO_ACCOUNT_HEADER] = accountId;
    }
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path}${query}`, {
      method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiClientError(0, TRANSPORT_ERROR_CODE, TRANSPORT_ERROR_MESSAGE);
  }
  const payload = await readBody(response);
  if (!response.ok) {
    throw errorForResponse(response, payload);
  }
  return { status: response.status, payload };
}

/**
 * Reads a response body as JSON, yielding `null` when there is nothing to read.
 *
 * An empty body and a body that is not JSON both yield `null` rather than throwing: a
 * failure that answered with `null` is then raised with the status it arrived with and a
 * generic sentence, which is what the contract asks of a body that is not the envelope.
 */
async function readBody(response: Response): Promise<unknown> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return null;
  }
  const trimmed = body.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** The API's single failure envelope, as this module reads it. */
interface ErrorEnvelope {
  /** The stable code the failure is identified by. */
  readonly code: string;
  /** The sentence a page renders as the explanation. */
  readonly message: string;
}

/**
 * Reads `{ error: { code, message } }` from a parsed body, or `null` when the body is not
 * that envelope.
 *
 * Both members must be non-empty strings: an envelope carrying a blank sentence is treated
 * as no envelope at all, so a page always receives something it can render and never an
 * empty message.
 */
function envelopeOf(payload: unknown): ErrorEnvelope | null {
  if (!isRecord(payload)) {
    return null;
  }
  const error = payload["error"];
  if (!isRecord(error)) {
    return null;
  }
  const code = readString(error["code"]);
  const message = readString(error["message"]);
  if (code === "" || message === "") {
    return null;
  }
  return { code, message };
}

/**
 * The whole seconds a `Retry-After` header stated, or `null`.
 *
 * Parsed defensively, as the throttling contract requires: an absent header, a non-numeric
 * value and an HTTP-date form all yield `null`, so a page renders its own retry message
 * rather than an unreadable interval. The write rate limit answers in whole seconds.
 */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

/** The code to use for a failure that arrived without the envelope — see {@link STATUS_FALLBACK_CODES}. */
function fallbackCodeFor(status: number): string {
  return STATUS_FALLBACK_CODES[status] ?? "internal_error";
}

/** The sentence to use for a failure that arrived without the envelope. */
function fallbackMessageFor(status: number): string {
  if (status === 429) {
    return RATE_LIMIT_MESSAGE;
  }
  return status >= 500 ? SERVER_ERROR_MESSAGE : CLIENT_ERROR_MESSAGE;
}

/**
 * The typed error a non-2xx response is raised as.
 *
 * The envelope's own code and sentence are used wherever the body was that envelope, so a
 * page renders the server's explanation — the sentence naming the fixture cases a `422`
 * submission omitted included. A body that was not the envelope yields the status, the code
 * the API answers that status with, and a generic sentence.
 */
function errorForResponse(response: Response, payload: unknown): ApiClientError {
  const status = response.status;
  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
  const envelope = envelopeOf(payload);
  if (envelope !== null) {
    return new ApiClientError(status, envelope.code, envelope.message, retryAfterSeconds);
  }
  return new ApiClientError(status, fallbackCodeFor(status), fallbackMessageFor(status), retryAfterSeconds);
}

/**
 * The typed error a response that cannot be read as its contract's shape is raised with:
 * the status it actually had, and a sentence that explains the client could not read it.
 * Raised for a success body that is not the entity it should be, for a list body that
 * carries no array, and for a row whose required fields cannot be read, so a page shows an
 * explanation rather than failing on an absent field or rendering a blank.
 *
 * Because it carries the status the response actually had, a caller can tell this failure
 * from the service's own refusals: a refusal the service made always carries its own 4xx/5xx
 * status, while this one carries the success status the unreadable answer arrived with.
 */
function unreadableResponse(status: number): ApiClientError {
  return new ApiClientError(status, UNREADABLE_RESPONSE_CODE, UNREADABLE_RESPONSE_MESSAGE);
}

/** A payload as a record, or `null` when it is not one. */
function recordOrNull(payload: unknown): Record<string, unknown> | null {
  return isRecord(payload) ? payload : null;
}

/** A payload as a record, refusing one that is not — a response with no body to read. */
function requireRecord(response: ApiResponse): Record<string, unknown> {
  const record = recordOrNull(response.payload);
  if (record === null) {
    throw unreadableResponse(response.status);
  }
  return record;
}

/**
 * A single-entity response as the entity it created or read.
 *
 * Each key names the wrapper a response may put the entity under — `{ listing: { ... } }`
 * beside a flat `{ ... }` — so the same client reads either form and no page knows which
 * one the server chose.
 */
function entityFrom<T>(response: ApiResponse, keys: readonly string[]): T {
  const record = requireRecord(response);
  for (const key of keys) {
    const nested = record[key];
    if (isRecord(nested)) {
      return nested as unknown as T;
    }
  }
  return record as unknown as T;
}

/**
 * A list read's rows: a bare array, or the array under one of the keys the read may use.
 *
 * The plan fixes the envelope of four list reads and leaves four unnamed, so this accepts
 * either form and refuses a payload that carries no array at all — an answer with no rows
 * is `items: []`, which is a state a page renders, while a body with no array is a
 * response that cannot be read.
 */
function requireArray(response: ApiResponse, keys: readonly string[]): unknown[] {
  if (Array.isArray(response.payload)) {
    return response.payload;
  }
  const record = recordOrNull(response.payload);
  if (record !== null) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  throw unreadableResponse(response.status);
}

/**
 * A nested collection as an array, and the empty list when it is absent.
 *
 * Used for the collections an entity carries — a listing's versions and claims, a report's
 * per-case evidence. An absent one is the empty state the page already renders for "nothing
 * recorded yet", never a crash.
 */
function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The rows of a collection that a standard, a challenge or a thread owns.
 *
 * A read may nest a standard's versions, a challenge's responses or a thread's posts inside
 * the row they belong to, or send them beside the rows as a second array. The nested form
 * is preferred; the sibling form is grouped by the owner column the sibling row itself
 * carries, so a page reads the same value under either layout and never the raw shape.
 */
function ownedCollection(
  nested: unknown,
  siblings: readonly unknown[],
  ownerField: string,
  ownerId: string,
): unknown[] {
  if (Array.isArray(nested)) {
    return nested;
  }
  if (ownerId === "") {
    return [];
  }
  return siblings.filter((row: unknown): boolean => isRecord(row) && readString(row[ownerField]) === ownerId);
}

/** A count read from a payload, falling back to a value the request already fixes. */
function countOr(value: unknown, fallback: number): number {
  return readCount(value) ?? fallback;
}

/** A count a response must state — the allocation rate the founder ledger is read with. */
function requireCount(value: unknown, response: ApiResponse): number {
  const count = readCount(value);
  if (count === null) {
    throw unreadableResponse(response.status);
  }
  return count;
}

/**
 * A listing status read from a moderation response.
 *
 * The closed vocabulary is checked rather than assumed, because this is one of the few
 * places this module builds a value of its own out of an unshaped payload: an operator who
 * was told a listing is hidden when it is not would be misled, so a status outside
 * {@link LISTING_STATUSES} is a response that cannot be read.
 */
function listingStatusOf(value: unknown, response: ApiResponse): ListingStatus {
  const status = readString(value);
  const match = LISTING_STATUSES.find((candidate: ListingStatus): boolean => candidate === status);
  if (match === undefined) {
    throw unreadableResponse(response.status);
  }
  return match;
}

/**
 * The outcome of a listing's latest report, and `null` when the listing states none.
 *
 * The report pair is the one place a closed-vocabulary field may legitimately be absent: a
 * listing whose newest version carries no report sends `null` (or omits the key), and that
 * absence stays `null` for the pages, which render it with the `No SGI report yet` copy
 * rather than an outcome of this client's own.
 *
 * A value that is **present** and names no member of {@link REPORT_OUTCOMES} is a response
 * that cannot be read, on the same rule {@link listingStatusOf} applies to a listing status:
 * the outcome is rendered as an outcome, so this module renders the closed vocabulary it was
 * sent and never a word outside it.
 */
function reportOutcomeOf(value: unknown, response: ApiResponse): ReportOutcome | null {
  if (value === null || value === undefined) {
    return null;
  }
  const outcome = readMember(value, REPORT_OUTCOMES);
  if (outcome === null) {
    throw unreadableResponse(response.status);
  }
  return outcome;
}

/**
 * The label of a listing's latest report, `null` when the listing states none.
 *
 * Read on exactly the rule {@link reportOutcomeOf} reads the outcome with — nullable where
 * the listing has no report, and refused rather than rendered verbatim when a present value
 * names no member of {@link REPORT_LABELS}.
 */
function reportLabelOf(value: unknown, response: ApiResponse): ReportLabel | null {
  if (value === null || value === undefined) {
    return null;
  }
  const label = readMember(value, REPORT_LABELS);
  if (label === null) {
    throw unreadableResponse(response.status);
  }
  return label;
}

/**
 * A listing's pricing model, read from its closed vocabulary.
 *
 * Not nullable, unlike the report pair: every listing declares one and the column is
 * constrained to {@link PRICING_MODELS}, so a value that names no member is a response that
 * cannot be read rather than a listing offered on a term this client does not hold.
 */
function pricingModelOf(value: unknown, response: ApiResponse): PricingModel {
  const pricingModel = readMember(value, PRICING_MODELS);
  if (pricingModel === null) {
    throw unreadableResponse(response.status);
  }
  return pricingModel;
}

/**
 * Adds one filter to a search query, and nothing when the filter is absent or blank: a
 * filter a page did not choose is dropped rather than sent empty, which would narrow the
 * search to nothing.
 */
function appendFilter(params: URLSearchParams, name: string, value: string | undefined): void {
  const filter = readString(value).trim();
  if (filter === "") {
    return;
  }
  params.set(name, filter);
}

/** The page a search query states, and the first page when it states none. */
function requestedPage(query: ListingSearchQuery): number {
  const page = readCount(query.page);
  return page === null || page < 1 ? 1 : page;
}

/**
 * The query of `GET /listings`: the five named filters, the resolved ordering and the
 * 1-based page, and **no page size**.
 *
 * The size is the fixed {@link LISTING_PAGE_SIZE} of the contract and is not a client input,
 * so no `limit`, `size` or `per_page` is ever sent: an accepted one would turn a fixed page
 * into a convention a client could ask around.
 */
function listingSearchQuery(query: ListingSearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  appendFilter(params, "q", query.q);
  appendFilter(params, "category", query.category);
  appendFilter(params, "license", query.license);
  appendFilter(params, "model", query.model);
  appendFilter(params, "standard", query.standard);
  appendFilter(params, "sort", query.sort);
  params.set("page", String(requestedPage(query)));
  return params;
}

/**
 * The query of `GET /compare`: between {@link COMPARE_MIN_IDS} and {@link COMPARE_MAX_IDS}
 * identifiers joined by {@link COMPARE_ID_SEPARATOR} into the one `ids` token the schema
 * validates.
 *
 * The bound is refused here as well as at the route, so a selection that could not be laid
 * out side by side never leaves the page; an identifier that is blank or carries the
 * separator would change the token count the route reads, so it is refused for the same
 * reason.
 */
function compareQuery(ids: readonly string[]): URLSearchParams {
  const identifiers = ids.map((id: string): string => id.trim());
  if (identifiers.length < COMPARE_MIN_IDS || identifiers.length > COMPARE_MAX_IDS) {
    throw new ApiClientError(
      400,
      "validation_error",
      `A comparison shows between ${COMPARE_MIN_IDS} and ${COMPARE_MAX_IDS} listings; ${identifiers.length} were selected.`,
    );
  }
  for (const identifier of identifiers) {
    if (identifier === "" || identifier.includes(COMPARE_ID_SEPARATOR)) {
      throw new ApiClientError(
        400,
        "validation_error",
        "A comparison can only name listing identifiers, and one selection was empty or carried the separator.",
      );
    }
  }
  const params = new URLSearchParams();
  params.set("ids", identifiers.join(COMPARE_ID_SEPARATOR));
  return params;
}

/** A category as a page renders it, with every member present. */
function normalizeCategory(value: unknown): Category {
  const record = recordOrNull(value) ?? {};
  return {
    id: readString(record["id"]),
    slug: readString(record["slug"]),
    name: readString(record["name"]),
  };
}

/**
 * One search result as the listings page reads it: every text member a string, the category
 * resolved, and the report provenance an explicit `null` when the listing's latest version
 * has no report.
 *
 * This is where a page stops depending on the wire: whether the payload spelled a missing
 * report field as `null` or omitted it, the value a card receives is the same
 * {@link ListingSummary}.
 *
 * The three closed-vocabulary members are read from their vocabularies rather than asserted
 * — the pricing model from {@link PRICING_MODELS}, the outcome and the label through
 * {@link reportOutcomeOf} and {@link reportLabelOf} — so a word outside one of them is a
 * response that cannot be read rather than a card rendering it verbatim.
 */
function normalizeListingSummary(value: unknown, response: ApiResponse): ListingSummary {
  const record = recordOrNull(value) ?? {};
  return {
    id: readString(record["id"]),
    slug: readString(record["slug"]),
    title: readString(record["title"]),
    summary: readString(record["summary"]),
    developer_handle: readString(record["developer_handle"]),
    category: normalizeCategory(record["category"]),
    pricing_model: pricingModelOf(record["pricing_model"], response),
    license_code: readString(record["license_code"]),
    version_string: readString(record["version_string"]),
    outcome: reportOutcomeOf(record["outcome"], response),
    standard_version_id: readText(record["standard_version_id"]),
    label: reportLabelOf(record["label"], response),
    limitation: readText(record["limitation"]),
  };
}

/**
 * One listing's detail as the listing page reads it: the report provenance and the resolved
 * category as above, the pricing model read from its own vocabulary rather than left to the
 * spread below, and its version history, claims and offer models as arrays — the empty list
 * when the response carried none, which is the state the page renders for a listing with
 * nothing published yet.
 */
function normalizeListingDetail(response: ApiResponse): ListingDetail {
  const record = requireRecord(response);
  return {
    ...(record as unknown as ListingDetail),
    developer_handle: readString(record["developer_handle"]),
    category: normalizeCategory(record["category"]),
    // Read explicitly rather than left to the spread above: `pricing_model` names a closed
    // vocabulary, and the spread would carry whatever the payload held into a field the page
    // renders as the term the listing is offered on.
    pricing_model: pricingModelOf(record["pricing_model"], response),
    versions: arrayOrEmpty(record["versions"]) as ListingVersion[],
    // The version history arrives as a bounded page — the most recent one — so the number of
    // versions the listing holds in all is read beside it rather than inferred from the page: a
    // client that took the page for the history would show 20 versions of a listing that has 108.
    version_total: requireCount(record["version_total"], response),
    claims: arrayOrEmpty(record["claims"]) as ListingClaim[],
    report_id: readText(record["report_id"]),
    outcome: reportOutcomeOf(record["outcome"], response),
    standard_version_id: readText(record["standard_version_id"]),
    label: reportLabelOf(record["label"], response),
    offer_models: arrayOrEmpty(record["offer_models"]) as OfferModel[],
  };
}

/**
 * One column of a comparison: the same normalisation as a search result, with the claims and
 * the collected limitations as arrays, so a side-by-side table renders a listing that states
 * no limitation as one that states none rather than as one that failed to load.
 *
 * The three closed-vocabulary members are read exactly as {@link normalizeListingSummary}
 * reads them, so a column shows a pricing model, an outcome and a label the vocabulary holds
 * or reports a response that cannot be read.
 */
function normalizeCompareEntry(value: unknown, response: ApiResponse): CompareEntry {
  const record = recordOrNull(value) ?? {};
  return {
    listing_id: readString(record["listing_id"]),
    title: readString(record["title"]),
    claims: arrayOrEmpty(record["claims"]) as ListingClaim[],
    report_id: readText(record["report_id"]),
    outcome: reportOutcomeOf(record["outcome"], response),
    standard_version_id: readText(record["standard_version_id"]),
    label: reportLabelOf(record["label"], response),
    limitations: arrayOrEmpty(record["limitations"]).map(readString),
    license_code: readString(record["license_code"]),
    pricing_model: pricingModelOf(record["pricing_model"], response),
  };
}

/** The record a report is carried in, whether the response nests it or sends it flat. */
function reportRecord(response: ApiResponse): Record<string, unknown> {
  const record = requireRecord(response);
  for (const key of ["evaluation_report", "report"]) {
    const nested = record[key];
    if (isRecord(nested)) {
      return nested;
    }
  }
  return record;
}

/**
 * One report as the report page reads it: the stored report exactly as it arrived, with its
 * per-case evidence an array — the empty list when the response carried none.
 *
 * Nothing here is derived. The outcome, the counts, the label, the rubric reference and the
 * prior report a retest points at all arrive from the server, which is what keeps the report
 * a record of what was measured rather than a computation of this client's.
 */
function normalizeReportDetail(response: ApiResponse): EvaluationReportDetail {
  const record = reportRecord(response);
  return {
    ...(record as unknown as EvaluationReportDetail),
    case_results: arrayOrEmpty(record["case_results"]) as ReportCaseResult[],
  };
}

/**
 * One row of the public challenges board: the challenge, with the responses it has collected
 * as an array. An unanswered challenge carries the empty list, which is the state the board
 * renders for a question no one has answered yet.
 */
export interface ChallengeListItem extends Challenge {
  /** The responses the challenge has collected, in the order they were written. */
  readonly responses: readonly ChallengeResponse[];
}

/**
 * One row of the public discussion board: the thread, with its posts as an array. A thread
 * with no replies carries the empty list rather than an absent key.
 */
export interface ThreadListItem extends Thread {
  /** The posts the thread has collected, in the order they were written. */
  readonly posts: readonly ThreadPost[];
}

/**
 * One row of the standards catalogue: the standard, with the versions published under it, the page of
 * the proposals made against it this read carries, and the number of proposals it holds in all.
 *
 * The thresholds a version carries are what the standards page renders, and a proposal's
 * status is what the review trail is read from, so both collections are present here even
 * when empty — a standard with no proposal yet is an ordinary state.
 */
export interface StandardListItem extends Standard {
  /** The versions published under this standard, newest first. */
  readonly versions: readonly StandardVersion[];
  /** The proposals made against this standard, in the order they were submitted. */
  readonly proposals: readonly StandardProposal[];
  /**
   * How many proposals this standard holds in all, so a reader can tell the page it carries from the
   * standard's whole proposal history: `proposals` is one page of that history, while this is the
   * number the next page of it would answer with.
   */
  readonly proposal_total: number;
}

/**
 * The body of `POST /moderation/listings/{id}/actions`: one action from
 * {@link MODERATION_ACTIONS} and the reason it is taken, which the contract requires and
 * records as an appended governance event.
 */
export interface ListingModerationBody {
  /** The action the operator applies: `flag`, `hide` or `restore`. */
  readonly action: ModerationAction;
  /** The operator's stated reason, recorded with the appended event. */
  readonly reason: string;
}

/**
 * What a moderation action answers with: the listing's new status and the governance event
 * the route appended.
 *
 * The event is what makes the operator's decision auditable, and it is read from the
 * response because the record of the decision is append-only: the listing's status is a
 * column that moves, while the reason behind it is an event that never changes. `event` is
 * `null` only when the response carried none.
 */
export interface ListingModerationResult {
  /** The listing the action was applied to. */
  readonly listing_id: string;
  /** The listing's status after the action, one of {@link LISTING_STATUSES}. */
  readonly status: ListingStatus;
  /** The governance event the route appended, or `null` when the response carried none. */
  readonly event: GovernanceEvent | null;
}


/**
 * `GET /listings?q&category&license&model&standard&sort&page` (public).
 *
 * The five filters are optional and a blank one is not sent, `sort` and `page` are resolved
 * before the request, and the page size is the contract's fixed {@link LISTING_PAGE_SIZE} —
 * never a parameter, and the one thing this read checks on the way back: a page carrying
 * more rows than the fixed size would silently break paging, so it is refused rather than
 * rendered.
 *
 * An empty result is a result: `items: []` is returned as it arrived, because no listing
 * matching a search is an ordinary state the listings page renders with the filters that
 * produced it.
 *
 * Raises {@link ApiClientError} for `400` (a parameter the query schema rejects) and for a
 * response that carries no rows to read.
 */
export async function listListings(query: ListingSearchQuery): Promise<ListingSearchResult> {
  const response = await send("GET", "/listings", { query: listingSearchQuery(query) });
  const items = requireArray(response, ["items"]).map(
    (raw: unknown): ListingSummary => normalizeListingSummary(raw, response),
  );
  if (items.length > LISTING_PAGE_SIZE) {
    throw new ApiClientError(
      response.status,
      UNREADABLE_RESPONSE_CODE,
      `A listing search answers with at most ${LISTING_PAGE_SIZE} results, and this response carried more.`,
    );
  }
  const record = recordOrNull(response.payload);
  return {
    items,
    total: record === null ? items.length : countOr(record["total"], items.length),
    page: record === null ? requestedPage(query) : countOr(record["page"], requestedPage(query)),
  };
}

/**
 * `GET /listings/{id}` (public): one listing with its version history, its claims and
 * limitations, the report its latest version carries and the offer models it makes.
 *
 * The read is asked as the selected demo account when one is selected, which is what makes
 * a hidden listing readable to the operator with the history it keeps. That changes nothing
 * for anyone else: an absent selection, one naming no seeded account and an account whose
 * role is not the operator all leave the public outcome as it is, where a hidden listing is
 * a `404`. The row is public, so an absent selection is never a refusal here — unlike a
 * write, this read raises no `401` of its own.
 *
 * Raises {@link ApiClientError} for `404` — an unknown or removed listing, including a
 * hidden one read by anyone but the operator, which the listing page renders as its absent
 * state — and for a response whose body cannot be read as a listing.
 */
export async function getListing(id: string): Promise<ListingDetail> {
  const response = await send("GET", `/listings/${encodeURIComponent(id)}`, {
    optionalDemoAccount: true,
  });
  return normalizeListingDetail(response);
}

/**
 * `GET /compare?ids=a,b,c` (public): two to four listings side by side, each with its
 * claims, the evidence measured against its latest version, the standard version and the
 * label of that evidence, its stated limitations, its license and its pricing model.
 *
 * The columns follow the order the caller named them in. A selection outside
 * {@link COMPARE_MIN_IDS}..{@link COMPARE_MAX_IDS} is refused here before anything is sent,
 * with the `400` the route would have answered it with.
 *
 * Raises {@link ApiClientError} for `400` (a selection the schema rejects), `404` (an
 * identifier naming no listing) and a response carrying no entries.
 */
export async function compareListings(ids: readonly string[]): Promise<CompareResult> {
  const response = await send("GET", "/compare", { query: compareQuery(ids) });
  return {
    entries: requireArray(response, ["entries"]).map(
      (raw: unknown): CompareEntry => normalizeCompareEntry(raw, response),
    ),
  };
}

/**
 * `POST /listings` (developer): publishes a listing that is immediately `active`.
 *
 * The owning developer comes from the selected demo account, never from the body, and the
 * slug and status are the server's. Raises {@link ApiClientError} for `401` when no demo
 * account is selected or the selected one cannot be resolved, `403` when the resolved
 * account is not a developer, and `400` for a body the schema rejects.
 */
export async function createListing(body: ListingCreateBody): Promise<Listing> {
  const response = await send("POST", "/listings", { body, demoAccount: true });
  return entityFrom<Listing>(response, ["listing"]);
}

/**
 * `POST /listings/{id}/versions` (owning developer): publishes a version of a listing the
 * selected developer account owns.
 *
 * A version is append-only: a correction is a new version, and an evaluation always names
 * the version it measured. A `409` means this listing has already published this version
 * string, which is a field-level explanation rather than a fault of the request as a whole.
 *
 * Raises {@link ApiClientError} for `400` (a version string the pattern rejects), `404` (an
 * unknown listing), `409` (a duplicate version string), `401` and `403`.
 */
export async function createVersion(
  listingId: string,
  body: ListingVersionCreateBody,
): Promise<ListingVersion> {
  const response = await send("POST", `/listings/${encodeURIComponent(listingId)}/versions`, {
    body,
    demoAccount: true,
  });
  return entityFrom<ListingVersion>(response, ["listing_version", "version"]);
}

/**
 * `POST /evaluations` (developer, owner of the candidate version): the deterministic,
 * synchronous evaluation that writes a report.
 *
 * The body is the candidate version, the standard version and one recorded output per
 * fixture case — nothing is executed, and the body carries **no retest field**: the link to
 * a prior report is the server's to derive, and the label and the prior report both arrive
 * in the response.
 *
 * Raises {@link ApiClientError} for `400` (a malformed submission), `404` (an unknown
 * version or standard), `422` (a submission that records no output for a fixture case,
 * whose sentence names the missing case identifiers) and `403` when the selected developer
 * does not own the candidate version.
 */
export async function createEvaluation(body: EvaluationSubmission): Promise<EvaluationReportDetail> {
  const response = await send("POST", "/evaluations", { body, demoAccount: true });
  return normalizeReportDetail(response);
}

/**
 * `GET /evaluations/{id}` (public): one report with its per-case evidence.
 *
 * This is the read the report page is served from, and the route the `/reports/:id` address
 * maps to — the mapping lives here so no page builds an API URL. Reading a report needs no
 * demo account: anyone may read any report and its evidence.
 *
 * Raises {@link ApiClientError} for `404` (an unknown report) and for a response that cannot
 * be read as a report.
 */
export async function getReport(reportId: string): Promise<EvaluationReportDetail> {
  const response = await send("GET", `/evaluations/${encodeURIComponent(reportId)}`);
  return normalizeReportDetail(response);
}

/**
 * `POST /evaluations/{id}/appeals` (developer): opens an appeal against a report with a
 * stated reason.
 *
 * The report comes from the path and the ground for contesting it from the body. The
 * resolved account's role is the whole of the check the route makes — it performs no
 * ownership lookup, so any developer account may open an appeal against any report. An appeal
 * never changes the report it concerns: a ruling appends a governance event, and
 * `GET /evaluations/{id}` returns the identical report afterwards.
 *
 * Raises {@link ApiClientError} for `404` (an unknown report), `401`, `403` — the resolved
 * account is not a developer — and `400`.
 */
export async function openAppeal(reportId: string, body: AppealCreateBody): Promise<Appeal> {
  const response = await send("POST", `/evaluations/${encodeURIComponent(reportId)}/appeals`, {
    body,
    demoAccount: true,
  });
  return entityFrom<Appeal>(response, ["appeal"]);
}

/**
 * What a ruling answers with: the appeal in its new state and the governance event the ruling
 * appended.
 *
 * The two answer different questions. `appeal.status` is a column that moves and states where the
 * appeal stands now; `event` is the append-only row the ruling appended and holds the ground the
 * operator stated, which has no column of its own — the appeal row carries no ruled-at, ruled-by or
 * ruling-reason field — so the ground is rendered from the event beside the status it justified.
 * `event` is `null` only when the response carried none.
 */
export interface AppealRulingResult {
  /** The appeal as the ruling left it: `upheld` or `denied`. */
  readonly appeal: Appeal;
  /** The governance event the ruling appended, or `null` when the response carried none. */
  readonly event: GovernanceEvent | null;
}

/**
 * `POST /appeals/{id}/ruling` (operator): rules an appeal `upheld` or `denied`, with an optional
 * stated ground.
 *
 * The ruling moves the appeal's own status and appends a governance event that records it; it never
 * touches the report the appeal concerns, so a page reading a report before and after a ruling reads
 * the same evidence, the same totals and the same outcome. `reason` is optional because the contract
 * makes it optional: a ruling is not obliged to justify itself, and an appeal ruled without a stated
 * ground records that absence rather than a fabricated sentence.
 *
 * Raises {@link ApiClientError} for `400` (a `status` outside {@link APPEAL_RULINGS}), `404`
 * (`not_found`, an appeal identifier no row carries), `409` (`already_ruled`, an appeal that already
 * carries a terminal status — a ruling is final), `401` when no demo account is selected, `403` when
 * the resolved account is not an operator, and `429` when the write limit is reached.
 */
export async function ruleAppeal(
  appealId: string,
  body: AppealRulingBody,
): Promise<AppealRulingResult> {
  const response = await send("POST", `/appeals/${encodeURIComponent(appealId)}/ruling`, {
    body,
    demoAccount: true,
  });
  const record = requireRecord(response);
  const event = record["event"];
  return {
    appeal: entityFrom<Appeal>(response, ["appeal"]),
    event: isRecord(event) ? (event as unknown as GovernanceEvent) : null,
  };
}

/**
 * `POST /inquiries` (buyer): sends a buyer's inquiry about a listing.
 *
 * The buyer's identity comes from the selected demo account and the listing from the body.
 * An inquiry carries a message on a listing and nothing else, so no contact detail, payment
 * detail or financial information is collected or sent.
 *
 * Raises {@link ApiClientError} for `400` (a malformed body), `404` (an unknown listing),
 * `401`, and `403` when the resolved account is not a buyer.
 */
export async function createInquiry(body: InquiryCreateBody): Promise<Inquiry> {
  const response = await send("POST", "/inquiries", { body, demoAccount: true });
  return entityFrom<Inquiry>(response, ["inquiry"]);
}


/**
 * One row of a list read as the entity it is: the row itself when it is an object, and an
 * empty value when it is not, so normalising a row never throws on a payload that is not
 * shaped like the row it should be.
 */
function entityRow<T>(raw: unknown): T {
  return (isRecord(raw) ? raw : {}) as unknown as T;
}

/**
 * `GET /challenges` (public): the challenges board, each challenge with the responses it has
 * collected.
 *
 * The responses are returned with their challenge under either layout the read may use —
 * nested in the row, or beside the rows as a second collection grouped by the `challenge_id`
 * each response carries — so the board never reads a raw shape. A challenge with no response
 * yet carries the empty list.
 *
 * Raises {@link ApiClientError} for a response that carries no challenges to read.
 */
export async function listChallenges(): Promise<ChallengeListItem[]> {
  const response = await send("GET", "/challenges");
  const payload = recordOrNull(response.payload);
  const siblings = payload === null ? [] : arrayOrEmpty(payload["responses"]);
  return requireArray(response, ["items", "challenges"]).map((raw: unknown): ChallengeListItem => {
    const record = recordOrNull(raw) ?? {};
    return {
      ...entityRow<Challenge>(raw),
      responses: ownedCollection(
        record["responses"],
        siblings,
        "challenge_id",
        readString(record["id"]),
      ) as ChallengeResponse[],
    };
  });
}

/**
 * `POST /challenges` (buyer): asks a question about a listing on the public board.
 *
 * The buyer's identity comes from the selected demo account and the listing from the body.
 * Raises {@link ApiClientError} for `400` (a malformed body), `404` (an unknown listing),
 * `401` and `403` when the resolved account is not a buyer.
 */
export async function createChallenge(body: ChallengeCreateBody): Promise<Challenge> {
  const response = await send("POST", "/challenges", { body, demoAccount: true });
  return entityFrom<Challenge>(response, ["challenge"]);
}

/**
 * `POST /challenges/{id}/responses` (buyer or developer): answers a challenge.
 *
 * Either the buyer who asked the question or the listing's developer may respond, which is
 * why this row is not role-checked beyond the demo account resolving. Answering moves the
 * challenge from `open` to `responded`; the question itself is never rewritten.
 *
 * Raises {@link ApiClientError} for `400` (a malformed body), `404` (an unknown challenge)
 * and `401`.
 */
export async function respondToChallenge(
  challengeId: string,
  body: ChallengeResponseBody,
): Promise<ChallengeResponse> {
  const response = await send("POST", `/challenges/${encodeURIComponent(challengeId)}/responses`, {
    body,
    demoAccount: true,
  });
  return entityFrom<ChallengeResponse>(response, ["challenge_response", "response"]);
}

/**
 * `GET /threads` (public): the discussion board, each thread with the posts it has collected.
 *
 * The posts come back with their thread under either layout the read may use — nested in the
 * row, or beside the rows as a second collection grouped by the `thread_id` each post
 * carries. A thread with no reply yet carries the empty list, which is the state the board
 * renders rather than an absent key.
 *
 * Raises {@link ApiClientError} for a response that carries no threads to read.
 */
export async function listThreads(): Promise<ThreadListItem[]> {
  const response = await send("GET", "/threads");
  const payload = recordOrNull(response.payload);
  const siblings = payload === null ? [] : arrayOrEmpty(payload["posts"]);
  return requireArray(response, ["items", "threads"]).map((raw: unknown): ThreadListItem => {
    const record = recordOrNull(raw) ?? {};
    return {
      ...entityRow<Thread>(raw),
      posts: ownedCollection(record["posts"], siblings, "thread_id", readString(record["id"])) as ThreadPost[],
    };
  });
}

/**
 * `POST /threads` (any resolvable demo account): starts a thread on the discussion board.
 *
 * The author comes from the selected demo account, so no role check applies beyond the
 * account resolving. Raises {@link ApiClientError} for `400` (a malformed body) and `401`.
 */
export async function createThread(body: ThreadCreateBody): Promise<Thread> {
  const response = await send("POST", "/threads", { body, demoAccount: true });
  return entityFrom<Thread>(response, ["thread"]);
}

/**
 * `POST /threads/{id}/posts` (any resolvable demo account): replies on a thread.
 *
 * A post is append-only: no route updates or deletes one. Raises {@link ApiClientError} for
 * `400` (a malformed body), `404` (an unknown thread) and `401`.
 */
export async function createPost(threadId: string, body: ThreadPostBody): Promise<ThreadPost> {
  const response = await send("POST", `/threads/${encodeURIComponent(threadId)}/posts`, {
    body,
    demoAccount: true,
  });
  return entityFrom<ThreadPost>(response, ["thread_post", "post"]);
}


/**
 * One catalogue row's standard, read field by field, or a raised failure when a field this
 * client has to state cannot be read.
 *
 * `id`, `code` and `title` are what a catalogue entry is addressed and labelled by, so a row
 * that states none of them is reported rather than rendered as a nameless entry; a blank
 * `summary` is an ordinary state the page renders without one.
 */
function standardRowFrom(raw: unknown, response: ApiResponse): Standard {
  const record = recordOrNull(raw) ?? {};
  const id = readText(record["id"]);
  const code = readText(record["code"]);
  const title = readText(record["title"]);
  if (id === null || code === null || title === null) {
    throw unreadableResponse(response.status);
  }
  return {
    id,
    code,
    title,
    summary: readString(record["summary"]),
  };
}

/**
 * One standard version, read field by field, or a raised failure when a field a reader is
 * shown cannot be read.
 *
 * Every field here is rendered by the standards page — the identity list, the status
 * sentence, the four thresholds and the rubric reference — which is why a version that states
 * none of them is reported rather than returned with blanks where its criteria belong. The
 * stored `definition_json` is read as text and no more: the row's columns are the criteria,
 * and a serialized copy parsed here would be a second authority for the same rule.
 */
function standardVersionRowFrom(raw: unknown, response: ApiResponse): StandardVersion {
  const record = recordOrNull(raw) ?? {};
  const id = readText(record["id"]);
  const standardId = readText(record["standard_id"]);
  const versionLabel = readText(record["version_label"]);
  const status = readMember(record["status"], STANDARD_STATUSES);
  const totalCases = readCount(record["total_cases"]);
  const criticalCases = readCount(record["critical_cases"]);
  const passThresholdMatches = readCount(record["pass_threshold_matches"]);
  const criticalFailuresAllowed = readCount(record["critical_failures_allowed"]);
  const rubricReference = readText(record["rubric_reference"]);
  const publishedAt = readText(record["published_at"]);
  if (
    id === null ||
    standardId === null ||
    versionLabel === null ||
    status === null ||
    totalCases === null ||
    criticalCases === null ||
    passThresholdMatches === null ||
    criticalFailuresAllowed === null ||
    rubricReference === null ||
    publishedAt === null
  ) {
    throw unreadableResponse(response.status);
  }
  return {
    id,
    standard_id: standardId,
    version_label: versionLabel,
    status,
    total_cases: totalCases,
    critical_cases: criticalCases,
    pass_threshold_matches: passThresholdMatches,
    critical_failures_allowed: criticalFailuresAllowed,
    rubric_reference: rubricReference,
    definition_json: readString(record["definition_json"]),
    published_at: publishedAt,
  };
}

/**
 * One standard proposal, read field by field, or a raised failure when a field a reader is
 * shown cannot be read.
 *
 * The status is what the review trail is read from, and it is taken from the closed
 * vocabulary rather than from a word of this client's own: a proposal whose status names no
 * member of it is reported rather than shown under a decision the service never recorded.
 */
function standardProposalRowFrom(raw: unknown, response: ApiResponse): StandardProposal {
  const record = recordOrNull(raw) ?? {};
  const id = readText(record["id"]);
  const standardId = readText(record["standard_id"]);
  const proposerAccountId = readText(record["proposer_account_id"]);
  const title = readText(record["title"]);
  const rationale = readText(record["rationale"]);
  const status = readMember(record["status"], PROPOSAL_STATUSES);
  const createdAt = readText(record["created_at"]);
  if (
    id === null ||
    standardId === null ||
    proposerAccountId === null ||
    title === null ||
    rationale === null ||
    status === null ||
    createdAt === null
  ) {
    throw unreadableResponse(response.status);
  }
  return {
    id,
    standard_id: standardId,
    proposer_account_id: proposerAccountId,
    title,
    rationale,
    status,
    created_at: createdAt,
  };
}


/**
 * `GET /standards` (public): the standards catalogue, each standard with the versions
 * published under it and the proposals made against it.
 *
 * The versions and proposals come back with their standard under either layout the read may
 * use — nested in the row, or beside the rows as second collections grouped by the
 * `standard_id` each version and each proposal carries. Both collections are present and
 * empty when there is nothing to show, so the standards page renders a version's provisional
 * thresholds and a proposal's review status without reading the wire, and a standard with no
 * proposal yet renders that as an ordinary state rather than an absent key.
 *
 * Every field is read here and once, so no page normalises a standard, a version or a
 * proposal again: a row that states none of the fields this client carries is raised as an
 * unreadable response rather than dropped, and a page therefore reads a typed value.
 *
 * Each item's proposals are one page of that standard's proposal history — its most recent page — and
 * the number of proposals the standard holds in all is read beside it as the item's own
 * `proposal_total`, so a page discloses the page it holds instead of presenting it as the history.
 *
 * Raises {@link ApiClientError} for a response that carries no standards to read, and for one
 * whose standard, version or proposal rows, or a standard's proposal total, cannot be read.
 */
export async function listStandards(): Promise<StandardListItem[]> {
  const response = await send("GET", "/standards");
  const payload = recordOrNull(response.payload);
  const versions = payload === null ? [] : arrayOrEmpty(payload["versions"]);
  const proposals = payload === null ? [] : arrayOrEmpty(payload["proposals"]);
  return requireArray(response, ["items", "standards"]).map((raw: unknown): StandardListItem => {
    const record = recordOrNull(raw) ?? {};
    const standard = standardRowFrom(raw, response);
    return {
      ...standard,
      versions: ownedCollection(record["versions"], versions, "standard_id", standard.id).map(
        (entry: unknown): StandardVersion => standardVersionRowFrom(entry, response),
      ),
      proposals: ownedCollection(record["proposals"], proposals, "standard_id", standard.id).map(
        (entry: unknown): StandardProposal => standardProposalRowFrom(entry, response),
      ),
      // The proposals arrive as a bounded page — the most recent one — so the number of proposals
      // the standard holds in all is read beside it rather than inferred from the page: a client
      // that took the page for the history would show 20 proposals of a standard that has 25.
      proposal_total: requireCount(record["proposal_total"], response),
    };
  });
}

/**
 * `GET /standards/{id}/versions/{v}` (public): one published version of a standard, with the
 * thresholds the evaluator read and the rubric reference a report cites.
 *
 * The identifier is the standard's row id or the contract label `SGI-SO-1.0.0`, both of
 * which the standards page uses. The version is read field by field before it is returned, so
 * a page renders the criteria the answer stated rather than reading that answer itself.
 *
 * Raises {@link ApiClientError} for `404` — `unknown_standard` for an identifier naming no
 * standard, and `not_found` for a version it does not publish — and for a response that
 * carries no version this client can read: a version states its identifier, its standard, its
 * label, its status, its four thresholds and its rubric reference, and an answer that states
 * none of them is reported rather than returned with blanks.
 */
export async function getStandardVersion(standardId: string, version: string): Promise<StandardVersion> {
  const response = await send(
    "GET",
    `/standards/${encodeURIComponent(standardId)}/versions/${encodeURIComponent(version)}`,
  );
  const entity = entityFrom<unknown>(response, ["standard_version", "version"]);
  return standardVersionRowFrom(entity, response);
}

/**
 * `POST /standards/proposals` (contributor): submits a proposal to change a standard.
 *
 * The row is created `submitted`: `status` is not a client field, and the only route that
 * moves it is the operator review below. Raises {@link ApiClientError} for `400` (a malformed
 * body), `404` (an identifier naming no standard), `401`, and `403` when the resolved account
 * is not a contributor.
 */
export async function submitProposal(body: StandardProposalCreateBody): Promise<StandardProposal> {
  const response = await send("POST", "/standards/proposals", { body, demoAccount: true });
  return entityFrom<StandardProposal>(response, ["standard_proposal", "proposal"]);
}

/**
 * What the operator's review answers with: the proposal in its new state and the governance event
 * the review appended.
 *
 * A review's record is that event: the status the proposal now carries, and the ground the operator
 * stated with the decision, which has no column of the proposal's own. Both therefore travel
 * together, so the page that announces the decision renders the trail it left. `event` is `null` only
 * when the response carried none, which is how {@link moderateListing} reads its own decision too.
 */
export interface ProposalReviewResult {
  /** The proposal as the review left it: `accepted` or `rejected`, its text unchanged. */
  readonly proposal: StandardProposal;
  /** The governance event the review appended, or `null` when the response carried none. */
  readonly event: GovernanceEvent | null;
}

/**
 * `POST /standards/proposals/{id}/review` (operator): rules a proposal `accepted` or
 * `rejected` and appends a governance event.
 *
 * The review moves the proposal's status and never rewrites its title or rationale, so the
 * reasoning a decision answered stays readable afterwards; the event it appended — which carries the
 * ground the operator stated — comes back with the proposal, so the decision and its record are
 * announced together. Raises {@link ApiClientError} for `400` (a status outside the review
 * vocabulary), `404` (an unknown proposal), `409` (`already_decided`, a proposal that already
 * carries a terminal status) and `403` when the resolved account is not an operator.
 */
export async function reviewProposal(
  proposalId: string,
  body: StandardProposalReviewBody,
): Promise<ProposalReviewResult> {
  const response = await send("POST", `/standards/proposals/${encodeURIComponent(proposalId)}/review`, {
    body,
    demoAccount: true,
  });
  const record = requireRecord(response);
  const event = record["event"];
  return {
    proposal: entityFrom<StandardProposal>(response, ["standard_proposal", "proposal"]),
    event: isRecord(event) ? (event as unknown as GovernanceEvent) : null,
  };
}

/**
 * `POST /checkout-simulations` (buyer): runs the simulated purchase of an offer model a
 * listing makes.
 *
 * The amount is never a client input — it comes from the offer model the listing offers — and
 * the transaction that comes back states `simulated: true`, carries the synthetic currency
 * label and carries the disclosure label every simulated amount must render with. No real
 * payment exists anywhere in this flow, so there is no provider, no card field and no
 * currency symbol to show.
 *
 * Raises {@link ApiClientError} for `400` (a malformed body), `404` (an unknown listing or
 * version), `422` (`not_offered`, an offer model this listing does not make), `401` and `403`
 * when the resolved account is not a buyer.
 */
export async function createCheckoutSimulation(body: CheckoutSimulationBody): Promise<Transaction> {
  const response = await send("POST", "/checkout-simulations", { body, demoAccount: true });
  return entityFrom<Transaction>(response, ["transaction"]);
}

/**
 * What a refund answers with: the reversal entries the refund appended, and the appended row
 * of the `refunds` table itself.
 *
 * The entries are the ledger's record of the reversal. The row is the durable reference of the
 * act: a refund is append-only, so its identifier is what an operator cites afterwards, which
 * is why this call returns it rather than leaving the response's `refund` member unread.
 * `refund` is `null` only when the response carried none.
 */
export interface RefundReversalResult {
  /** The reversal entries the refund appended, in the order they were written. */
  readonly entries: LedgerEntry[];
  /** The `refunds` row the route appended, or `null` when the response carried none. */
  readonly refund: Refund | null;
}

/**
 * `POST /transactions/{id}/refunds` (operator): refunds a simulated transaction, in whole or
 * in part.
 *
 * The answer is the reversal entries the refund appended, in the order they were written,
 * beside the appended `refunds` row, which is the durable record of the act rather than a
 * figure derived from it: a refund appends to the ledger and edits nothing, so the transaction,
 * its allocation and every earlier entry stay exactly as they were and the net position is read
 * from the entries rather than stored.
 *
 * Raises {@link ApiClientError} for `400 validation_error` when the amount is missing, negative
 * or fractional, which the shared refund body schema refuses at the edge before the route runs,
 * and for `400 invalid_amount` when the amount is the `0` that schema deliberately admits and the
 * domain refuses; `404` (`transaction_not_found`), `409` (`already_fully_refunded`), `422`
 * (`exceeds_net_remaining`, an amount larger than the transaction's net remaining), `401`
 * (`unauthorized`) when no demo account is selected — which this module raises before it sends
 * anything — and `403` when the resolved account is not an operator.
 */
export async function refundTransaction(
  transactionId: string,
  body: RefundCreateBody,
): Promise<RefundReversalResult> {
  const response = await send("POST", `/transactions/${encodeURIComponent(transactionId)}/refunds`, {
    body,
    demoAccount: true,
  });
  const record = recordOrNull(response.payload);
  const refund = record === null ? null : record["refund"];
  return {
    entries: requireArray(response, ["entries", "items"]) as LedgerEntry[],
    refund: isRecord(refund) ? (refund as unknown as Refund) : null,
  };
}

/**
 * `GET /ledger/marketplace`, `GET /ledger/gate-fees` and `GET /ledger/founder-allocation`
 * (operator): one of the three append-only ledgers, in insertion order.
 *
 * The three keep separate meaning, not merely separate rows: a gate-evaluation fee is
 * recorded in the gate-fee ledger only and is never eligible for an allocation, and the
 * founder allocation applies to the net amount of an eligible completed simulated
 * marketplace transaction and to nothing else. The `ledger` returned is the ledger that was
 * requested, and the entries are read from those the response carried — an unused ledger
 * answers with the empty list, which is a state and not a failure.
 *
 * The founder-allocation read additionally states the configured rate its entries were
 * computed from, and an amount cannot be presented without it: the read requires the rate
 * rather than defaulting it, so a ledger view never shows an allocation beside a rate it did
 * not actually use.
 *
 * These are the operator-only reads, which is why this read requires the demo account
 * header. Raises {@link ApiClientError} for `403` when the resolved account is not an
 * operator and for a response whose ledger body cannot be read.
 */
export async function listLedger(
  ledger: LedgerName,
): Promise<LedgerReadResult | FounderAllocationLedgerReadResult> {
  const response = await send("GET", `/ledger/${LEDGER_PATH_SEGMENTS[ledger]}`, { demoAccount: true });
  const record = requireRecord(response);
  const entries = arrayOrEmpty(record["entries"]) as LedgerEntry[];
  // The read is bounded — one page of the ledger, the most recent page first — so the page it
  // answered and the number of entries the ledger holds are part of what this call returns: a
  // ledger view that showed a page without them could not tell a short ledger from a clipped one.
  const total = requireCount(record["total"], response);
  const page = requireCount(record["page"], response);
  if (ledger === "founder_allocation") {
    return {
      ledger,
      entries,
      total,
      page,
      rate_basis_points: requireCount(record["rate_basis_points"], response),
    };
  }
  return { ledger, entries, total, page };
}

/**
 * `POST /moderation/listings/{id}/actions` (operator): flags, hides or restores a listing,
 * with a stated reason.
 *
 * The action moves the listing's status — `hide` removes it from browse while the operator
 * still reads it with its history, `restore` returns it, and `flag` records a concern without
 * changing whether it is visible — and appends a governance event carrying the reason. No
 * action rewrites anything: not a report, not a standard version, not a ledger entry and not
 * the listing's own past events, which is what keeps an operator's power additive and keeps a
 * measurement out of its reach.
 *
 * Raises {@link ApiClientError} for `400` (a missing action or reason, or an action outside
 * {@link MODERATION_ACTIONS}), `404` (an unknown listing), `401`, `403` when the resolved
 * account is not an operator, and for a response that states no listing status.
 */
export async function moderateListing(
  listingId: string,
  body: ListingModerationBody,
): Promise<ListingModerationResult> {
  const response = await send(
    "POST",
    `/moderation/listings/${encodeURIComponent(listingId)}/actions`,
    { body, demoAccount: true },
  );
  const record = requireRecord(response);
  const listing = isRecord(record["listing"]) ? record["listing"] : record;
  const resolvedId = readString(listing["id"]);
  const event = record["event"];
  return {
    listing_id: resolvedId === "" ? listingId : resolvedId,
    status: listingStatusOf(listing["status"], response),
    event: isRecord(event) ? (event as unknown as GovernanceEvent) : null,
  };
}

/**
 * `GET /sponsored-slots` (public): the limited sponsorship demonstration, as its own labelled
 * collection.
 *
 * Each item carries `sponsored: true`, and the block it fills is rendered below a page's
 * organic results and never interleaved with them. Nothing here measures a reader: no slot
 * holds an identifier of a person seen or a count of views, and no sponsorship reaches a
 * measurement, a badge or the organic order. An empty collection is a complete answer — the
 * pages that render this block render nothing when it is empty — so a body carrying no items
 * yields the empty list rather than an error, and a sponsorship read can never blank the page
 * it appears on.
 */
export async function listSponsoredSlots(): Promise<SponsoredSlotListResult> {
  const response = await send("GET", "/sponsored-slots");
  const payload = response.payload;
  const items = Array.isArray(payload) ? payload : arrayOrEmpty(recordOrNull(payload)?.["items"]);
  return { items: items as SponsoredSlotListItem[] };
}

/**
 * `GET /audit-events` (operator): the append-only feed of what was written — the actor, the
 * action, the resource, the status and the reason, in the order the writes happened.
 *
 * This is the feed of what was *written*; the governance events behind a moderation action, a
 * proposal review or an appeal ruling are the feed of what was *decided*. Neither substitutes
 * for the other and neither is ever amended.
 *
 * This is one of the four operator-only reads, so it carries the demo account header. Raises
 * {@link ApiClientError} for `403` when the resolved account is not an operator and for a
 * response that carries no events to read.
 */
export async function listAuditEvents(): Promise<AuditEvent[]> {
  const response = await send("GET", "/audit-events", { demoAccount: true });
  return requireArray(response, ["items", "audit_events"]) as AuditEvent[];
}

