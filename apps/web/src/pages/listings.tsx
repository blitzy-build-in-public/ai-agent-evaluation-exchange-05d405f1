/**
 * The `/listings` route: search the exchange, narrow it down, page through the results and read the
 * labelled sponsored block beneath them.
 *
 * Six decisions shape this file, and each is stated here because a later reader could otherwise
 * undo one of them into a defect.
 *
 * **The address is the state.** The query box, the four filters, the ordering and the page live in
 * the query string and nowhere else: `useSearchParams` reads them, `../components/search-filters`
 * owns writing them, and this page only turns them into the request the contract fixes. A second
 * copy of any of them would give a filtered view two truths, would not survive a copied address,
 * and would stop the back button from stepping through the filters that were applied.
 *
 * **One read per resolved query.** The listings read is keyed on the canonical serialisation of the
 * resolved query rather than on the `URLSearchParams` object, whose identity changes on every
 * render, so the effect re-runs when the query actually changes and cannot loop. A result for a
 * query the reader has already left is never rendered: the in-flight state takes its place, which is
 * also what clears the previous results instead of showing them against filters they were not
 * matched by.
 *
 * **A parameter the contract refuses is explained rather than sent.** `page`, `model` and `sort` are
 * closed vocabularies and the search request types them, so a value outside one of them cannot be
 * expressed as a request at all — the client would have to replace it silently, and a page claiming
 * to search for one thing while asking for another is worse than a page that explains itself. Such
 * an address therefore renders the same `400` explanation the API would have given it, in the same
 * notice the API's own refusals use, with a link back to a query the contract accepts.
 *
 * **The sponsored block is separate, labelled, and silent when it has nothing.** It renders after the
 * organic results and never inside them, its heading is the label of the closed vocabulary, and
 * every item carries that same label beside the sponsor's fictional handle. While the read is in
 * flight, after it failed, when it holds nothing and when it holds only the other surface's
 * placements, the whole subtree renders nothing at all — no heading, no box, no empty state and no
 * error text — because the absence of an advertisement is not a state a reader needs to be told
 * about.
 *
 * **An empty result is explained with the filters that produced it.** No listing matching a search is
 * an ordinary successful state (`200` with `items: []`) and never an error, so the page names each
 * filter that is set and offers the one action that widens the search again. A page past the end of a
 * non-empty result set is a different state and says so, with the last page offered as the way back.
 *
 * **The vocabulary is imported, never retyped.** The page size, the default ordering, the pricing
 * models, the orderings and the sponsored label come from `@adem/shared`, and the "no report" copy is
 * `../components/listing-card`'s to render, so the wording here cannot drift from the value the API,
 * the badge and the end-to-end assertions all agree on. Nothing on this page states or implies
 * general safety, certified security, independent certification or a guaranteed pass, and no
 * sponsored item is described as recommended, verified or trusted.
 *
 * Presentation only: `../api-client` is the only module in this workspace that calls the API, and the
 * three calls below are public reads, so this page holds no URL, no request header, no storage and no
 * analytics of its own. The page owns the document's single `<main>` landmark and its single `<h1>`;
 * the shell renders the header, the navigation, the demonstration banner and the account switcher,
 * and no landmark of its own. The class names are the stylesheet's own: `.page` and `.page-listings`
 * on the route root, `.item-list` and `.item-list__item` for the results, `.status-region` for the
 * one polite live region, `.field__group` for the row of paging controls (the stylesheet holds no
 * pager rule of its own, and adding one would mean editing a file this page does not own), and
 * `.sponsored-block`, which owns its heading and its list.
 */

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  DEFAULT_LISTING_SORT,
  LISTING_PAGE_SIZE,
  LISTING_SORTS,
  PRICING_MODELS,
  SPONSORED_LABEL,
} from "@adem/shared";
import type {
  ListingSearchQuery,
  ListingSearchResult,
  ListingSort,
  ListingSummary,
  PricingModel,
  SponsoredPlacementKey,
  SponsoredSlotListItem,
  SponsoredSlotListResult,
} from "@adem/shared";

import { ApiClientError, listListings, listSponsoredSlots, listStandards } from "../api-client";
import type { StandardListItem } from "../api-client";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { ListingCard } from "../components/listing-card";
import { SearchFilters } from "../components/search-filters";
import type { FilterOption } from "../components/search-filters";
import { SponsoredLabel } from "../components/sponsored-label";
import { describePricingModel } from "../labels";

/** The route this page owns, and the address its clearing and recovering links point at. */
const LISTINGS_PATH = "/listings";

/** The developer's own surface, offered from the empty exchange rather than from a filtered search. */
const DEVELOPER_PATH = "/developer";

/**
 * The query parameter names, spelled exactly as the `GET /listings` contract and the shared search
 * schema spell them, so the request this page builds and the address it reads cannot disagree.
 */
const QUERY_PARAM = "q";
const CATEGORY_PARAM = "category";
const LICENSE_PARAM = "license";
const MODEL_PARAM = "model";
const STANDARD_PARAM = "standard";
const SORT_PARAM = "sort";
const PAGE_PARAM = "page";

/**
 * The one surface this page's sponsored block belongs to, typed from the closed placement vocabulary
 * rather than held as a bare string: a placement key that left that vocabulary would fail the build
 * here instead of silently emptying this page's block.
 */
const LISTINGS_PLACEMENT: SponsoredPlacementKey = "listings";

/** The status the contract answers a request it refuses with, and the code that travels with it. */
const VALIDATION_ERROR_STATUS = 400;
const VALIDATION_ERROR_CODE = "validation_error";

/** The longest value a refusal quotes back, so an address cannot stretch the explanation it gets. */
const DISPLAY_VALUE_MAX_LENGTH = 60;

/** The heading outline: one page title, then one heading per section, then a card or state heading. */
const PAGE_HEADING = "Browse listings";
const PAGE_INTRO =
  "Search what developers have published, and read each result's measured outcome, standard version and label beside its summary, its stated limitation, its license and its pricing model. Every listing is offered on synthetic data, and the evidence behind one comes from a fixture set rather than from a certification.";
const FILTERS_HEADING = "Search and filter";
const RESULTS_HEADING = "Results";

/** The paging controls and the reasons a control that cannot move states for itself. */
const PAGER_LABEL = "Search result pages";
const FIRST_PAGE_LABEL = "First page";
const PREVIOUS_PAGE_LABEL = "Previous page";
const NEXT_PAGE_LABEL = "Next page";
const LAST_PAGE_LABEL = "Last page";
const FIRST_PAGE_REASON = "this is the first page";
const SINGLE_PAGE_REASON = "the results fit on one page";
const LAST_PAGE_REASON = "this is the last page";

/** The one sentence the results region carries while the read is in flight. */
const LOADING_MESSAGE = "Loading listings…";

/**
 * The sentence the refusal notice carries as its message. It names no value of its own: the values a
 * reader can see in the address are quoted in the notice's detail, where they are rendered as text
 * rather than echoed into a message that a response body and a page share.
 */
const REFUSAL_MESSAGE =
  "The address carries a value the listing search contract refuses, so no request was sent for it.";

/** The explanation of a refusal, and the label of the link that resolves the address to a valid one. */
const ACCEPTED_PAGE_VALUES = "a whole page number of 1 or more";
const REFUSED_PAGE_PARAMETER_NOTE = `The listing search pages results ${String(LISTING_PAGE_SIZE)} at a time, and the page parameter names which of those pages to read.`;

/** The empty-result copy, in the two states an empty page of results can mean. */
const NO_LISTINGS_HEADING = "No listings are published yet";
const NO_LISTINGS_EXPLANATION =
  "Nothing has been published to the exchange yet. A developer publishes a listing and a version of it, and both appear in this search as soon as they are created.";
const PUBLISH_LISTING_LABEL = "Publish a listing";
const NO_MATCH_HEADING = "No listings match these filters";
const CLEAR_FILTERS_LABEL = "Clear the filters and search the whole exchange";
const LAST_PAGE_OF_RESULTS_LABEL = "Go to the last page of results";
const START_WITHOUT_FILTERS_LABEL = "Start a search with no filters";

/**
 * The note a failed standard-versions read leaves behind. It is a note rather than a failure of the
 * page: the standard filter falls back to the value the address already carries, the results below
 * are the ones the API answered with, and the only thing lost is a list of options.
 */
const STANDARDS_FILTER_FAILURE_MESSAGE =
  "The list of standard versions could not be read, so the standard filter offers only the value the address already carries. The results below are unaffected.";
const STANDARDS_FILTER_RETRY_LABEL = "Try reading the standard versions again";

/** The disclosure the sponsored block carries, and nothing that claims merit for an item. */
const SPONSORED_DISCLOSURE =
  "These placements are labelled advertising, shown as a limited demonstration. They sit below the results above and are never sorted into them, and a sponsorship buys no ranking, no evaluation outcome and no badge. Nothing here measures a reader.";

/**
 * The state of the listings read. Each member carries the canonical key of the query it answers, so a
 * result that belongs to a query the reader has already left can be told from the current one instead
 * of being rendered as though it answered the current address.
 */
type ListingsRead =
  | { readonly status: "loading"; readonly queryKey: string }
  | { readonly status: "ready"; readonly queryKey: string; readonly result: ListingSearchResult }
  | { readonly status: "failed"; readonly queryKey: string; readonly failure: unknown };

/**
 * The state of the standard-versions read. Its failure is a note beside the filter rather than a
 * failure of the page, so it is remembered as its own state instead of being collapsed into the empty
 * option list that a still-loading read also produces.
 */
type StandardsRead =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly standards: readonly StandardListItem[] }
  | { readonly status: "failed" };

/**
 * The state of the sponsorship read. All three members render nothing on their own; they are kept
 * apart so that "still reading", "nothing for this surface" and "the read failed" stay
 * distinguishable in the code rather than collapsing into one empty array.
 */
type SponsoredRead =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly slots: readonly SponsoredSlotListItem[] }
  | { readonly status: "failed" };

/**
 * One parameter of the address the contract refuses: the parameter's own name, the value the address
 * carries for it, and what the contract accepts in its place, each stated in a reader's terms.
 */
interface AddressRefusal {
  /** The parameter at fault, spelled as the address spells it. */
  readonly parameter: string;
  /** The value the address carries for it, bounded so a long one cannot stretch the explanation. */
  readonly value: string;
  /** What the contract accepts for that parameter, as the notice states it. */
  readonly expects: string;
}

/**
 * The result of reading the address once: the request the contract accepts, the canonical key of that
 * request, and the one parameter the contract refuses if the address carries one.
 *
 * The request is built even when a parameter is refused, so that every consumer reads one shape; it is
 * simply never sent while a refusal stands.
 */
interface AddressQuery {
  /** The request the contract accepts, with the default ordering and page resolved. */
  readonly query: ListingSearchQuery;
  /** The canonical serialisation of that request, used as the read's identity. */
  readonly queryKey: string;
  /** The parameter the contract refuses, or `null` when the address can be sent as it stands. */
  readonly refusal: AddressRefusal | null;
}

/** One filter as the empty state names it: what the reader set, and the value they set it to. */
interface ActiveFilter {
  /** The reader-facing name of the filter: "search text", "category", "license", "pricing model". */
  readonly name: string;
  /** The value the address carries, resolved to the label the filter offers where one exists. */
  readonly value: string;
}

/** One paging control: where it moves to, or why it cannot move at all. */
interface PagerControl {
  /** The control's own label, which is also its React key. */
  readonly label: string;
  /** The page the control moves to when it can move. */
  readonly targetPage: number;
  /** Why the control cannot move, or `null` when it can. */
  readonly blockedReason: string | null;
}

/** One sponsored item as this page renders it: the fictional sponsor's label and the item's key. */
interface ListingsSponsoredItem {
  /** The React list key: the slot's identifier, or a positional fallback when it carries none. */
  readonly key: string;
  /** The sponsor's fictional label, rendered beside the disclosure label. */
  readonly sponsorLabel: string;
}

/** A comparison that orders two strings by code unit, so an option list is stable between runs. */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * A value as it may be quoted back to a reader: bounded in length, so a long or hand-edited address
 * produces a sentence rather than a wall of text. Nothing here decides whether the value is safe to
 * render — it is rendered as text by React, which escapes it.
 */
function displayValue(value: string): string {
  return value.length <= DISPLAY_VALUE_MAX_LENGTH
    ? value
    : `${value.slice(0, DISPLAY_VALUE_MAX_LENGTH)}...`;
}

/**
 * The value of one query parameter, or `null` when it is absent or blank.
 *
 * A parameter written with no value is the state a cleared filter leaves behind in an address that
 * was typed by hand, and it means the same thing as an absent one: the filter is not set.
 */
function trimmedParam(searchParams: URLSearchParams, name: string): string | null {
  const raw = searchParams.get(name);
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** A whole page number of 1 or more, or `null` for anything else the address might carry. */
function readPositiveInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** The canonical serialisation of a resolved request: what one read is identified by. */
function queryKeyOf(query: ListingSearchQuery): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) {
    params.set(QUERY_PARAM, query.q);
  }
  if (query.category !== undefined) {
    params.set(CATEGORY_PARAM, query.category);
  }
  if (query.license !== undefined) {
    params.set(LICENSE_PARAM, query.license);
  }
  if (query.model !== undefined) {
    params.set(MODEL_PARAM, query.model);
  }
  if (query.standard !== undefined) {
    params.set(STANDARD_PARAM, query.standard);
  }
  params.set(SORT_PARAM, query.sort);
  params.set(PAGE_PARAM, String(query.page));
  return params.toString();
}

/** The identity of a refusal, so that a change of refusal re-runs the read that skips it. */
function refusalKeyOf(refusal: AddressRefusal | null): string {
  return refusal === null ? "" : `${refusal.parameter}=${refusal.value}`;
}

/**
 * The address read once: the request it resolves to and the one parameter it cannot express.
 *
 * The closed vocabularies are checked in the order a reader reads the address, so the sentence a
 * refusal produces names the first value that cannot be sent. A parameter that is absent or blank is
 * not a refusal: it simply narrows nothing.
 */
function readAddressQuery(searchParams: URLSearchParams): AddressQuery {
  const q = trimmedParam(searchParams, QUERY_PARAM);
  const category = trimmedParam(searchParams, CATEGORY_PARAM);
  const license = trimmedParam(searchParams, LICENSE_PARAM);
  const standard = trimmedParam(searchParams, STANDARD_PARAM);
  const modelValue = trimmedParam(searchParams, MODEL_PARAM);
  const sortValue = trimmedParam(searchParams, SORT_PARAM);
  const pageValue = trimmedParam(searchParams, PAGE_PARAM);

  const model =
    PRICING_MODELS.find((candidate: PricingModel): boolean => candidate === modelValue) ?? null;
  const sort = LISTING_SORTS.find((candidate: ListingSort): boolean => candidate === sortValue) ?? null;
  const page = readPositiveInteger(pageValue);

  let refusal: AddressRefusal | null = null;
  if (pageValue !== null && page === null) {
    refusal = {
      parameter: PAGE_PARAM,
      value: displayValue(pageValue),
      expects: ACCEPTED_PAGE_VALUES,
    };
  } else if (modelValue !== null && model === null) {
    refusal = {
      parameter: MODEL_PARAM,
      value: displayValue(modelValue),
      expects: `one of the four pricing models the exchange serves: ${PRICING_MODELS.join(", ")}`,
    };
  } else if (sortValue !== null && sort === null) {
    refusal = {
      parameter: SORT_PARAM,
      value: displayValue(sortValue),
      expects: `one of the orderings the search contract serves: ${LISTING_SORTS.join(", ")}`,
    };
  }

  const query: ListingSearchQuery = { sort: sort ?? DEFAULT_LISTING_SORT, page: page ?? 1 };
  if (q !== null) {
    query.q = q;
  }
  if (category !== null) {
    query.category = category;
  }
  if (license !== null) {
    query.license = license;
  }
  if (model !== null) {
    query.model = model;
  }
  if (standard !== null) {
    query.standard = standard;
  }

  return { query, queryKey: queryKeyOf(query), refusal };
}

/** Options in one deterministic order: by label, then by value, both by code unit and never by locale. */
function sortOptions(options: readonly FilterOption[]): readonly FilterOption[] {
  return [...options].sort((left: FilterOption, right: FilterOption): number => {
    const byLabel = compareText(left.label, right.label);
    return byLabel === 0 ? compareText(left.value, right.value) : byLabel;
  });
}

/** One label for one value, or the value itself when the list does not offer it. */
function optionLabel(options: readonly FilterOption[], value: string): string {
  return options.find((option: FilterOption): boolean => option.value === value)?.label ?? value;
}

/**
 * The union of two option lists, for the category and license filters the API publishes no endpoint
 * for.
 *
 * The filters are derived from what the search already returned, which means the list would otherwise
 * shrink to whatever the current result set happens to contain — and a reader who narrowed to the
 * first category would find the second one gone from the control that narrowed them. The union keeps
 * every value the exchange has shown in this visit, keyed by value and labelled by the first label
 * seen for it, which is bounded by the vocabularies themselves: four categories and the licenses the
 * developers have used.
 */
function mergeFilterOptions(
  existing: readonly FilterOption[],
  incoming: readonly FilterOption[],
): readonly FilterOption[] {
  const merged = new Map<string, string>();
  existing.forEach((option: FilterOption): void => {
    merged.set(option.value, option.label);
  });
  incoming.forEach((option: FilterOption): void => {
    if (!merged.has(option.value)) {
      merged.set(option.value, option.label);
    }
  });
  return sortOptions(
    Array.from(merged, ([value, label]: [string, string]): FilterOption => ({ value, label })),
  );
}

/**
 * The category and license options one page of results offers. A value that is absent or blank is not
 * an option: a filter that narrowed to nothing would be a control that could only empty the page.
 */
function deriveListingOptions(items: readonly ListingSummary[]): {
  readonly categories: readonly FilterOption[];
  readonly licenses: readonly FilterOption[];
} {
  const categories = new Map<string, string>();
  const licenses = new Map<string, string>();

  items.forEach((listing: ListingSummary): void => {
    const slug = listing.category.slug.trim();
    if (slug !== "" && !categories.has(slug)) {
      const name = listing.category.name.trim();
      categories.set(slug, name === "" ? slug : name);
    }
    const license = listing.license_code.trim();
    if (license !== "" && !licenses.has(license)) {
      licenses.set(license, license);
    }
  });

  return {
    categories: sortOptions(
      Array.from(categories, ([value, label]: [string, string]): FilterOption => ({ value, label })),
    ),
    licenses: sortOptions(
      Array.from(licenses, ([value, label]: [string, string]): FilterOption => ({ value, label })),
    ),
  };
}

/**
 * The standard filter's options, taken from the standards catalogue because a listing's search result
 * carries a standard version label and nothing else that names it.
 *
 * The value is the version's own label, which is the form the `standard` query parameter narrows on:
 * a report's payload states it, the listings page offers it, and the service hands it to the registry
 * that owns both of a version's spellings to resolve it to a row. The row identifier is a second
 * spelling of the same version that this parameter does not accept, so offering it as an option value
 * would submit a filter the service refuses on every use.
 *
 * The label is the standard's code, which for this release already carries the version in it. The
 * version label is added only when the code does not already contain it, so the seeded `SGI-SO-1.0.0`
 * reads as itself while a later version of it stays distinguishable. A version row whose label is
 * absent cannot be filtered on and is left out.
 */
function standardVersionOptions(standards: readonly StandardListItem[]): readonly FilterOption[] {
  const options = new Map<string, string>();

  standards.forEach((standard: StandardListItem): void => {
    const code = standard.code.trim();
    standard.versions.forEach((version): void => {
      const versionLabel = version.version_label.trim();
      if (versionLabel === "" || options.has(versionLabel)) {
        return;
      }
      let label: string;
      if (code === "") {
        label = versionLabel;
      } else if (code.includes(versionLabel)) {
        label = code;
      } else {
        label = `${code} (${versionLabel})`;
      }
      options.set(versionLabel, label);
    });
  });

  return sortOptions(
    Array.from(options, ([value, label]: [string, string]): FilterOption => ({ value, label })),
  );
}

/** The filters the address sets, named as a reader sees them and resolved to the labels on offer. */
function activeFiltersOf(
  query: ListingSearchQuery,
  categories: readonly FilterOption[],
  licenses: readonly FilterOption[],
  standards: readonly FilterOption[],
): readonly ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (query.q !== undefined) {
    filters.push({ name: "search text", value: query.q });
  }
  if (query.category !== undefined) {
    filters.push({ name: "category", value: optionLabel(categories, query.category) });
  }
  if (query.license !== undefined) {
    filters.push({ name: "license", value: optionLabel(licenses, query.license) });
  }
  if (query.model !== undefined) {
    // The model is the one closed vocabulary this page does not derive an option list for — the
    // contract itself fixes its four values — so it is named through the one formatter that
    // presents it, exactly as the filters above are named through the options they offer. The
    // address keeps the value the contract carries; the sentence names what the reader chose.
    filters.push({ name: "pricing model", value: describePricingModel(query.model) });
  }
  if (query.standard !== undefined) {
    filters.push({ name: "standard version", value: optionLabel(standards, query.standard) });
  }
  return filters;
}

/** A list of items read as a sentence: "a", "a and b", "a, b and c". */
function joinWithAnd(parts: readonly string[]): string {
  const first = parts[0];
  if (first === undefined) {
    return "";
  }
  const last = parts[parts.length - 1];
  if (parts.length === 1 || last === undefined) {
    return first;
  }
  return `${parts.slice(0, -1).join(", ")} and ${last}`;
}

/** The filters that produced an empty result, as one clause a reader can act on. */
function describeActiveFilters(filters: readonly ActiveFilter[]): string {
  return joinWithAnd(filters.map((filter: ActiveFilter): string => `${filter.name} "${filter.value}"`));
}

/** How many results there are, in the reader's own words. */
function countLabel(total: number): string {
  return total === 1 ? "1 listing" : `${String(total)} listings`;
}

/** The last page a result set of this size has, or page 1 when there is nothing to page through. */
function lastPageNumber(total: number): number {
  return total <= 0 ? 1 : Math.ceil(total / LISTING_PAGE_SIZE);
}

/** Where the results stop, as the paging controls and the past-the-end state phrase it. */
function pastLastPageReason(lastPage: number): string {
  return `the results stop at page ${String(lastPage)}`;
}

/**
 * What the results region states about the page it is showing.
 *
 * It is one sentence in every settled state, and the page size is named in it rather than offered as a
 * control, because the size is the contract's fixed {@link LISTING_PAGE_SIZE} and not a client input.
 * An empty page of a non-empty result set states where the results stop, which is the difference
 * between "no such listing" and "not on this page".
 */
function describeResults(page: number, total: number, shown: number, lastPage: number): string {
  if (shown === 0) {
    if (total === 0) {
      return "No listings match the filters the address carries.";
    }
    return `No results on page ${String(page)}; ${pastLastPageReason(lastPage)}.`;
  }
  if (total <= 1) {
    return `Showing the one result, on page 1 of 1. Each page holds up to ${String(LISTING_PAGE_SIZE)} results.`;
  }
  const first = (page - 1) * LISTING_PAGE_SIZE + 1;
  const last = first + shown - 1;
  return `Showing ${String(first)}-${String(last)} of ${String(total)} results, on page ${String(page)} of ${String(lastPage)}. Each page holds up to ${String(LISTING_PAGE_SIZE)} results.`;
}

/** The address of one page of the same search: every other parameter is carried through untouched. */
function hrefForPage(searchParams: URLSearchParams, targetPage: number): string {
  const next = new URLSearchParams(searchParams);
  if (targetPage <= 1) {
    next.delete(PAGE_PARAM);
  } else {
    next.set(PAGE_PARAM, String(targetPage));
  }
  return pathWithQuery(next);
}

/** The address with one parameter removed, which is how a refused value is resolved. */
function hrefWithoutParameter(searchParams: URLSearchParams, name: string): string {
  const next = new URLSearchParams(searchParams);
  next.delete(name);
  return pathWithQuery(next);
}

/** A query string as the route's own address, with no trailing separator when it is empty. */
function pathWithQuery(params: URLSearchParams): string {
  const serialized = params.toString();
  return serialized === "" ? LISTINGS_PATH : `${LISTINGS_PATH}?${serialized}`;
}

/**
 * The paging controls, each either moving or stating why it cannot.
 *
 * Two questions decide what a control says, and they are not the same question: whether the reader
 * stands on the last page, and whether they have gone past it. A reader past the end still has a page
 * with results to return to, so Last stays a real link back to it and Previous steps back to it as
 * well rather than to the empty page in between — which is the page the past-the-end empty state's own
 * link already offers. Only a reader standing on the last page is told that it is the last one.
 */
function pagerControls(page: number, lastPage: number): readonly PagerControl[] {
  const atFirstPage = page <= 1;
  const onLastPage = page === lastPage;
  const pastLastPage = page > lastPage;
  const lastPageReason = lastPage === 1 ? SINGLE_PAGE_REASON : LAST_PAGE_REASON;

  // Next cannot move once the reader has reached the last page or gone beyond it, and which of the two
  // it is decides the reason it states: on the last page the results end there, while past it they
  // stopped at a page the reader has already left behind.
  let nextBlockedReason: string | null = null;
  if (onLastPage) {
    nextBlockedReason = lastPageReason;
  } else if (pastLastPage) {
    nextBlockedReason = pastLastPageReason(lastPage);
  }

  return [
    { label: FIRST_PAGE_LABEL, targetPage: 1, blockedReason: atFirstPage ? FIRST_PAGE_REASON : null },
    {
      label: PREVIOUS_PAGE_LABEL,
      // The greater lower bound of the last page and the page before this one: from two or more pages
      // past the end, Previous lands on the last page that holds results rather than walking the reader
      // back through the empty pages in between.
      targetPage: Math.max(1, Math.min(lastPage, page - 1)),
      blockedReason: atFirstPage ? FIRST_PAGE_REASON : null,
    },
    {
      label: NEXT_PAGE_LABEL,
      targetPage: Math.min(lastPage, page + 1),
      blockedReason: nextBlockedReason,
    },
    {
      label: LAST_PAGE_LABEL,
      targetPage: lastPage,
      blockedReason: onLastPage ? lastPageReason : null,
    },
  ];
}

/**
 * The status a failed read carries, or `null` when the value carries none.
 *
 * The value is whatever a rejected promise produced, so it is read defensively: only an object can
 * carry the field, the read itself is guarded because the field may be an accessor, and anything that
 * is not a whole number is no status at all. This is the same narrowing `../components/error-notice`
 * applies to the same value, and it is used for one decision only: whether a refusal is recoverable by
 * correcting the address or by asking again.
 */
function failureStatus(failure: unknown): number | null {
  if (typeof failure !== "object" || failure === null) {
    return null;
  }
  try {
    const status = Reflect.get(failure, "status");
    return typeof status === "number" && Number.isInteger(status) ? status : null;
  } catch {
    return null;
  }
}

/**
 * A value as displayable text, or `null` when there is nothing to display.
 *
 * A sponsor label this page did not construct is treated as a field with no text when it is absent,
 * blank or not a string at all: an item that would otherwise print `undefined`, `null` or an empty
 * line is left out instead, because a disclosure that renders half a sentence is worse than no item.
 */
function readableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether a value is an object this page may read fields from. */
function isReadableRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * The items of this page's own placement, ready to render.
 *
 * An item placed on another surface is dropped, because the home page owns the `home` block and this
 * page owns the `listings` block. An item whose sponsor label is missing, blank or not a string is
 * dropped as well, since this page could not name it. Neither omission reorders what remains: the
 * collection is rendered in the order it arrived.
 */
function listingsSponsoredItems(
  slots: readonly SponsoredSlotListItem[],
): readonly ListingsSponsoredItem[] {
  const items: ListingsSponsoredItem[] = [];
  slots.forEach((slot: SponsoredSlotListItem, index: number): void => {
    if (!isReadableRecord(slot) || slot.placement_key !== LISTINGS_PLACEMENT) {
      return;
    }
    const sponsorLabel = readableText(slot.sponsor_label);
    if (sponsorLabel === null) {
      return;
    }
    items.push({
      key: readableText(slot.id) ?? `sponsored-slot-${String(index)}`,
      sponsorLabel,
    });
  });
  return items;
}

/**
 * The notice a parameter the contract refuses is explained with.
 *
 * It is the same `400` the API would have answered such a query with, rendered through the same
 * component so a reader meets one shape whichever side refused: what happened, what it means, and how
 * to send something that can be answered. The link drops the parameter at fault and keeps every other
 * one, which is the smallest change that makes the address valid again — a reader who mistyped a page
 * number keeps the search they typed.
 */
function renderRefusalNotice(refusal: AddressRefusal, validHref: string): JSX.Element {
  return (
    <ErrorNotice
      error={new ApiClientError(VALIDATION_ERROR_STATUS, VALIDATION_ERROR_CODE, REFUSAL_MESSAGE)}
      detail={
        <>
          <p>
            {`The address carries "${refusal.value}" as the ${refusal.parameter} parameter, and the listing search contract accepts ${refusal.expects}.`}
          </p>
          {refusal.parameter === PAGE_PARAM ? <p>{REFUSED_PAGE_PARAMETER_NOTE}</p> : null}
          <p>
            <Link
              className="standalone-link"
              to={validHref}
            >
              {`Search without the ${refusal.parameter} parameter`}
            </Link>
          </p>
        </>
      }
    />
  );
}

/**
 * The notice a failed listings read is explained with.
 *
 * A `400` is the contract refusing the request itself, and the answer is an address it accepts, so the
 * notice offers that rather than a retry that would send the same refused request again. Every other
 * failure — a transport failure, a `500`, a throttled read — can be asked again unchanged, and carries
 * the retry control.
 */
function renderFailureNotice(failure: unknown, onRetry: () => void): JSX.Element {
  if (failureStatus(failure) !== VALIDATION_ERROR_STATUS) {
    return <ErrorNotice error={failure} onRetry={onRetry} />;
  }
  return (
    <ErrorNotice
      error={failure}
      detail={
        <p>
          <Link
            className="standalone-link"
            to={LISTINGS_PATH}
          >
            {START_WITHOUT_FILTERS_LABEL}
          </Link>
        </p>
      }
    />
  );
}

/**
 * The paging control row.
 *
 * Every control is a real link, so it is operable by keyboard, announced as a link and openable in a
 * new tab like any other address in the product. A control that cannot move renders as text stating
 * why: a control that looked pressable and did nothing would be a dead end, and a state carried by
 * colour alone would not be perceivable at all.
 */
function renderPager(page: number, lastPage: number, searchParams: URLSearchParams): JSX.Element {
  return (
    <nav className="field__group" aria-label={PAGER_LABEL}>
      {pagerControls(page, lastPage).map((control: PagerControl): JSX.Element =>
        control.blockedReason === null ? (
          <Link
            key={control.label}
            className="button button--secondary"
            to={hrefForPage(searchParams, control.targetPage)}
          >
            {control.label}
          </Link>
        ) : (
          <span key={control.label}>{`${control.label}: unavailable, ${control.blockedReason}`}</span>
        ),
      )}
    </nav>
  );
}

/**
 * What a settled read renders when the page holds no results, in the two states that can mean.
 *
 * An exchange with nothing published at all is not a failed search, so the first state offers the
 * action that starts one. A search whose filters matched nothing names every filter that produced it,
 * because "no results" without them is a dead end, and the action widens the search again. A page past
 * the end of a non-empty result set is neither: the filters are not at fault, the address is, so the
 * last page is offered as the way back.
 */
function renderNoResults(props: ResultsProps): JSX.Element {
  if (props.total > 0) {
    return (
      <EmptyState
        heading={`No results on page ${String(props.page)}`}
        headingLevel={3}
        explanation={`The filters applied match ${countLabel(props.total)}, and those results stop at page ${String(props.lastPage)}; page ${String(props.page)} is past the end of them.`}
        action={
          <Link to={hrefForPage(props.searchParams, props.lastPage)}>
            {LAST_PAGE_OF_RESULTS_LABEL}
          </Link>
        }
      />
    );
  }

  if (props.activeFilters.length === 0) {
    return (
      <EmptyState
        heading={NO_LISTINGS_HEADING}
        headingLevel={3}
        explanation={NO_LISTINGS_EXPLANATION}
        action={<Link to={DEVELOPER_PATH}>{PUBLISH_LISTING_LABEL}</Link>}
      />
    );
  }

  return (
    <EmptyState
      heading={NO_MATCH_HEADING}
      headingLevel={3}
      explanation={`Nothing matches ${describeActiveFilters(props.activeFilters)}. A filter narrows the search, so removing one widens it again.`}
      action={<Link to={LISTINGS_PATH}>{CLEAR_FILTERS_LABEL}</Link>}
    />
  );
}

/** Everything the results region renders, once the read has settled. */
interface ResultsProps {
  /** The results of the read, in the order the API returned them. */
  readonly items: readonly ListingSummary[];
  /** How many listings the filters matched across every page. */
  readonly total: number;
  /** The page the address asks for. */
  readonly page: number;
  /** The last page those results have. */
  readonly lastPage: number;
  /** The address, so a paging link carries every other parameter through untouched. */
  readonly searchParams: URLSearchParams;
  /** The filters the address sets, for the explanation an empty page of results needs. */
  readonly activeFilters: readonly ActiveFilter[];
}

/**
 * The settled results: one card per result, in the order the API returned them, then the paging
 * controls, which belong to every settled result set that holds something.
 *
 * The pager is not tied to a set with more than one page: the `page` action is the page's own way of
 * moving through its results, so a single-page set states there that its results fit on one page
 * rather than leaving a reader to guess whether paging exists at all. An empty result set renders no
 * pager — there is no page of it to move to, and the state below already says what the address asked
 * for.
 *
 * The page's results are deliberately not re-ordered here. The ordering the search contract guarantees
 * is the server's, stated by the `sort` parameter, and a client that sorted one page of it would be
 * ordering the page rather than the result set — a different thing that would look like the same one.
 */
function renderResults(props: ResultsProps): JSX.Element {
  const pager: JSX.Element | null =
    props.total > 0 ? renderPager(props.page, props.lastPage, props.searchParams) : null;

  if (props.items.length === 0) {
    return (
      <>
        {renderNoResults(props)}
        {pager}
      </>
    );
  }

  return (
    <>
      <ul className="item-list">
        {props.items.map((listing: ListingSummary, index: number): JSX.Element => (
          <li
            className="item-list__item"
            key={listing.id === "" ? `listing-${String(index)}` : listing.id}
          >
            <ListingCard listing={listing} />
          </li>
        ))}
      </ul>
      {pager}
    </>
  );
}

/**
 * The labelled sponsored block, rendered after the results and never interleaved with them.
 *
 * The caller renders it only when it holds something, which is what makes "render nothing" the single
 * behaviour for a read that is in flight, one that failed, one that returned nothing, and one that
 * returned only the other surface's placements.
 */
function renderSponsoredBlock(items: readonly ListingsSponsoredItem[]): JSX.Element {
  return (
    <section className="sponsored-block" aria-labelledby="listings-sponsored-heading">
      <h2 id="listings-sponsored-heading">{SPONSORED_LABEL}</h2>
      <p>{SPONSORED_DISCLOSURE}</p>
      <ul>
        {items.map((item: ListingsSponsoredItem): JSX.Element => (
          <li key={item.key}>
            <p>
              <SponsoredLabel /> {item.sponsorLabel}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The `/listings` route: the search, the four filters, the fixed-size pages of results and the
 * labelled sponsored block below them.
 *
 * Three reads run on mount and are independent of one another — the listings for the address, the
 * standards catalogue for the standard filter's options, and the sponsored slots for the block — so
 * none of them awaits another and a failure in one leaves the others exactly as they were. Only the
 * listings read follows the address: it re-runs when the resolved query changes and when the reader
 * asks for it again, and it is the only one with a retry control, because it is the only one whose
 * failure costs the page its content.
 *
 * The component holds no query state. Every rendered fact about the search comes from the address, and
 * the only state kept here is what the reads answered with, keyed by the query it answers.
 */
export function ListingsPage(): JSX.Element {
  const [searchParams] = useSearchParams();

  // The address, read once per render. It is cheap and pure, and every value the effects below depend
  // on is a primitive taken from it, so the effects cannot re-run merely because a fresh object was
  // allocated for the same address.
  const address = readAddressQuery(searchParams);
  const queryKey = address.queryKey;
  const refusalKey = refusalKeyOf(address.refusal);

  const [attempt, setAttempt] = useState<number>(0);
  const [read, setRead] = useState<ListingsRead>({ status: "loading", queryKey });
  const [standardsRead, setStandardsRead] = useState<StandardsRead>({ status: "loading" });
  const [standardsAttempt, setStandardsAttempt] = useState<number>(0);
  const [categoryOptions, setCategoryOptions] = useState<readonly FilterOption[]>([]);
  const [licenseOptions, setLicenseOptions] = useState<readonly FilterOption[]>([]);
  const [sponsoredRead, setSponsoredRead] = useState<SponsoredRead>({ status: "loading" });

  // The listings read. It is keyed on the resolved query, so it re-runs when the address means
  // something different and not when it is merely re-serialised; `attempt` lets a retry re-run it for
  // the address the reader is already looking at. The `cancelled` flag stops a settled read from
  // writing state after the page has gone or after a newer query has replaced this one.
  useEffect((): (() => void) | void => {
    // A refused parameter has no request to send: the request the client could build would carry a
    // value the reader did not write, and the refusal notice is what the page renders instead.
    if (address.refusal !== null) {
      return;
    }

    let cancelled = false;
    setRead({ status: "loading", queryKey });

    listListings(address.query).then(
      (result: ListingSearchResult): void => {
        if (cancelled) {
          return;
        }
        setRead({ status: "ready", queryKey, result });
        // What the search returned is the only source the category and license filters have, so each
        // answered page widens those two option lists rather than replacing them.
        const derived = deriveListingOptions(result.items);
        setCategoryOptions((previous: readonly FilterOption[]): readonly FilterOption[] =>
          mergeFilterOptions(previous, derived.categories),
        );
        setLicenseOptions((previous: readonly FilterOption[]): readonly FilterOption[] =>
          mergeFilterOptions(previous, derived.licenses),
        );
      },
      (failure: unknown): void => {
        if (!cancelled) {
          setRead({ status: "failed", queryKey, failure });
        }
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [queryKey, refusalKey, attempt]);

  // The standards read, independent of the address: it answers the same catalogue whatever is being
  // searched, so it runs once and again only when the reader asks it to.
  useEffect((): (() => void) => {
    let cancelled = false;
    setStandardsRead({ status: "loading" });

    listStandards().then(
      (standards: StandardListItem[]): void => {
        if (!cancelled) {
          setStandardsRead({ status: "ready", standards });
        }
      },
      (): void => {
        if (!cancelled) {
          setStandardsRead({ status: "failed" });
        }
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [standardsAttempt]);

  // The sponsorship read. Its failure is an empty block and nothing more — no message, no retry
  // control and no state the reader has to dismiss — so its rejection is recorded rather than
  // surfaced, and a sponsorship read can never blank the page it appears on.
  useEffect((): (() => void) => {
    let cancelled = false;

    listSponsoredSlots().then(
      (result: SponsoredSlotListResult): void => {
        if (!cancelled) {
          setSponsoredRead({ status: "ready", slots: result.items });
        }
      },
      (): void => {
        if (!cancelled) {
          setSponsoredRead({ status: "failed" });
        }
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, []);

  // A result for a query the address no longer means is not rendered as though it answered the current
  // one: the in-flight state takes its place, which is also what keeps the previous page of results
  // from being read against filters they were not matched by.
  const current: ListingsRead = read.queryKey === queryKey ? read : { status: "loading", queryKey };

  const standardOptions: readonly FilterOption[] =
    standardsRead.status === "ready" ? standardVersionOptions(standardsRead.standards) : [];

  const total = current.status === "ready" ? current.result.total : 0;
  const page = address.query.page;
  const lastPage = lastPageNumber(total);
  const shown = current.status === "ready" ? current.result.items.length : 0;
  const activeFilters = activeFiltersOf(
    address.query,
    categoryOptions,
    licenseOptions,
    standardOptions,
  );
  const sponsoredItems: readonly ListingsSponsoredItem[] =
    sponsoredRead.status === "ready" ? listingsSponsoredItems(sponsoredRead.slots) : [];

  // The one sentence the polite live region carries: what the search is doing, or what it found. A
  // failed read announces nothing here, because the notice below owns a polite region of its own and
  // two regions saying the same thing would be read twice.
  let announcement = "";
  if (address.refusal !== null) {
    announcement = REFUSAL_MESSAGE;
  } else if (current.status === "loading") {
    announcement = LOADING_MESSAGE;
  } else if (current.status === "ready") {
    announcement = describeResults(page, total, shown, lastPage);
  }

  let results: JSX.Element | null = null;
  if (address.refusal !== null) {
    results = renderRefusalNotice(
      address.refusal,
      hrefWithoutParameter(searchParams, address.refusal.parameter),
    );
  } else if (current.status === "failed") {
    results = renderFailureNotice(current.failure, handleRetry);
  } else if (current.status === "ready") {
    results = renderResults({
      items: current.result.items,
      total,
      page,
      lastPage,
      searchParams,
      activeFilters,
    });
  }

  function handleRetry(): void {
    setAttempt((value: number): number => value + 1);
  }

  function handleRetryStandards(): void {
    setStandardsAttempt((value: number): number => value + 1);
  }

  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` lets that link move
    // focus here without putting the landmark itself in the tab order.
    <main id="main-content" tabIndex={-1} className="page page-listings">
      <section aria-labelledby="listings-heading">
        <h1 id="listings-heading">{PAGE_HEADING}</h1>
        <p>{PAGE_INTRO}</p>
      </section>

      <section aria-labelledby="listings-filters-heading">
        <h2 id="listings-filters-heading">{FILTERS_HEADING}</h2>
        <SearchFilters
          categories={categoryOptions}
          licenses={licenseOptions}
          standards={standardOptions}
        />

        {/* The standard filter's options come from a read of their own. When it fails, the filter
            keeps the value the address carries and the results stay exactly as they are, so this is a
            note beside the filters rather than a failure of the page — and it is recoverable, which is
            why it carries its own retry control. */}
        {standardsRead.status === "failed" ? (
          <div>
            <div className="status-region" role="status" aria-live="polite">
              <p>{STANDARDS_FILTER_FAILURE_MESSAGE}</p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={handleRetryStandards}
            >
              {STANDARDS_FILTER_RETRY_LABEL}
            </button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="listings-results-heading">
        <h2 id="listings-results-heading">{RESULTS_HEADING}</h2>

        {/* One polite live region for the results, present from the first render so that its
            announcement is reliable. It carries the count and the page position, so a filter change is
            perceivable without sight of the list, and it stays empty while a failure is being
            explained by the notice below. */}
        <div className="status-region" role="status" aria-live="polite">
          {announcement === "" ? null : <p>{announcement}</p>}
        </div>

        {results}
      </section>

      {/* The sponsored block renders after the results and is never interleaved with them. When the
          read is in flight, failed, empty, or carries only another surface's placements, this list is
          empty and the whole subtree — its heading included — renders nothing at all, which is exactly
          what this block owes a reader. */}
      {sponsoredItems.length === 0 ? null : renderSponsoredBlock(sponsoredItems)}
    </main>
  );
}

// The default export is what app.tsx's route table imports, `ListingsPage` is the component's own
// name, and `Listings` follows the route-name convention its sibling pages use, so the route table can
// import the page under whichever name it reads best with. Both name the same component on purpose.
export { ListingsPage as Listings };
export default ListingsPage;
