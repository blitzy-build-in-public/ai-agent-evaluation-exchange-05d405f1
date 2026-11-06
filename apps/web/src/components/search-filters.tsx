/**
 * The listings search, filter and paging controls: the query box, the four filters, the ordering and
 * the page control.
 *
 * **The URL is the state.** Every control reads its value from the query string and writes a changed
 * value straight back to it, so a filtered view is a link a buyer can send, the back button steps
 * through the filters that were applied, and the listings page can state an empty result together
 * with the filters that produced it. A `q`, `category`, `license`, `model`, `standard`, `sort` or
 * `page` kept anywhere else would not survive a copy of the address.
 *
 * Three rules the controls keep.
 *
 * - **A changed filter drops `page`.** A stale page number against a narrower result set shows an
 *   empty list that reads as "no such listing" when the truth is "not on this page". Page 1 is the
 *   server's own default, so the parameter is omitted rather than written, and a filtered view's URL
 *   then carries only the filters that produced it.
 * - **Clearing a filter removes its parameter** rather than writing an empty value, so the page can
 *   tell an absent filter from a cleared one.
 * - **How many results one page holds is never a parameter.** It is the fixed `LISTING_PAGE_SIZE`;
 *   this component reads it only to state the range and the last page, and the contract's query
 *   schema accepts no field for it.
 *
 * Presentation only: no request, no storage, no cookie. The category, license and standard options
 * arrive as props because the contract exposes no endpoint that lists categories or licenses — the
 * page derives those from what it already received. A page number this component can refuse is
 * refused here with a message tied to its own field; a whole request the server refuses is the page's
 * to render, and the form takes no native validation so that message stays the only feedback.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_LISTING_SORT,
  LISTING_PAGE_SIZE,
  LISTING_SORTS,
  PRICING_MODELS,
} from "@adem/shared";
import type { ListingSort, PricingModel } from "@adem/shared";

/**
 * The query parameter names, spelled exactly as the `GET /listings` contract and the shared search
 * schema spell them, so the page can pass this component's query string straight to the API.
 */
const QUERY_PARAM = "q";
const CATEGORY_PARAM = "category";
const LICENSE_PARAM = "license";
const MODEL_PARAM = "model";
const STANDARD_PARAM = "standard";
const SORT_PARAM = "sort";
const PAGE_PARAM = "page";

/** How long the query box waits after the last keystroke before it writes the URL. */
const QUERY_DEBOUNCE_MS = 300;

/** The message a page number that is not a positive integer produces, tied to the page field. */
const PAGE_ERROR_MESSAGE = "Enter a page number of 1 or more";

/** The one character class the page field accepts as a keystroke. */
const DIGIT_PATTERN = /^[0-9]$/;

/** Human-readable labels for the closed vocabularies, keyed by the value the contract carries. */
const PRICING_MODEL_LABELS: Readonly<Record<PricingModel, string>> = {
  rent: "Rent",
  purchase: "Purchase",
  license: "License",
  subscription: "Subscription",
};

const SORT_LABELS: Readonly<Record<ListingSort, string>> = {
  relevance: "Relevance",
  newest: "Newest",
  outcome: "Outcome",
};

/** One option a filter offers: the value the query string carries and the label a reader sees. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Props for {@link SearchFilters}. All four are required: `exactOptionalPropertyTypes` is on, so a
 * prop the page cannot supply would have to be omitted rather than passed as `undefined`, and an
 * empty option list is a value the page can state plainly.
 */
export interface SearchFiltersProps {
  /** Distinct category values the page derived from its own listings result. */
  readonly categories: readonly FilterOption[];
  /** Distinct license codes the page derived from its own listings result. */
  readonly licenses: readonly FilterOption[];
  /** Standard version identifiers the page derived from its own listings result and listStandards. */
  readonly standards: readonly FilterOption[];
  /** The total from the search result, for the paging control's range and last-page logic. */
  readonly total: number;
}

/** Whether a query value is one of the orderings the contract accepts. */
function isListingSort(value: string | null): value is ListingSort {
  return LISTING_SORTS.some((sort: ListingSort): boolean => sort === value);
}

/** Whether a query value is one of the pricing models the contract accepts. */
function isPricingModel(value: string | null): value is PricingModel {
  return PRICING_MODELS.some((model: PricingModel): boolean => model === value);
}

/**
 * The 1-based page number a query value names, and `1` for anything else.
 *
 * A value outside the contract still has to leave every control in a state a reader can see, so the
 * page field shows the page such a request falls back to rather than a number the URL cannot mean.
 * The URL itself is left as it stands: the request the page builds from it is where a value the
 * server refuses is answered.
 */
function readPageNumber(value: string | null): number {
  if (value === null || value === "") {
    return 1;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * The options one filter renders: the page's own options, plus the value the URL carries when the
 * page could not derive it. A filter that matched nothing still shows what is applied, instead of
 * reading as "any" while a narrowing parameter sits in the address.
 */
function optionsWithActive(
  options: readonly FilterOption[],
  active: string,
): readonly FilterOption[] {
  if (active === "" || options.some((option: FilterOption): boolean => option.value === active)) {
    return options;
  }
  return [...options, { value: active, label: active }];
}

/**
 * What the pager states about the page it is on: the range the current page covers, or the
 * explanation an empty page needs. With no results at all it makes no range claim beyond that.
 */
function describePage(total: number, page: number, lastPage: number): string {
  if (total === 0) {
    return "No results";
  }
  if (page > lastPage) {
    return `No results on page ${page}. The last page is ${lastPage}.`;
  }
  const first = (page - 1) * LISTING_PAGE_SIZE + 1;
  const last = page * LISTING_PAGE_SIZE > total ? total : page * LISTING_PAGE_SIZE;
  return `Page ${page} of ${lastPage}: showing ${first}-${last} of ${total} results.`;
}

/** The pricing-model options, in the order the contract lists them. */
const PRICING_MODEL_OPTIONS: readonly FilterOption[] = PRICING_MODELS.map(
  (model: PricingModel): FilterOption => ({ value: model, label: PRICING_MODEL_LABELS[model] }),
);

/** The sort options, in the order the contract lists them. */
const SORT_OPTIONS: readonly FilterOption[] = LISTING_SORTS.map(
  (sort: ListingSort): FilterOption => ({ value: sort, label: SORT_LABELS[sort] }),
);

/** The option elements for one filter, each keyed by the value the query string carries. */
function renderOptions(options: readonly FilterOption[]): JSX.Element[] {
  return options.map(
    (option: FilterOption): JSX.Element => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ),
  );
}

/**
 * The filter bar above the listings: the query box, the four filters, the ordering and the page
 * control, all held in the URL.
 *
 * Rendering and the query string only — it sends no request, stores nothing, and reports the one
 * mistake it can see for itself: a page number that is not a positive integer, against the field
 * that carries it.
 */
export function SearchFilters(props: SearchFiltersProps): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const idPrefix = useId();

  const query = searchParams.get(QUERY_PARAM) ?? "";
  const category = searchParams.get(CATEGORY_PARAM) ?? "";
  const license = searchParams.get(LICENSE_PARAM) ?? "";
  const modelParam = searchParams.get(MODEL_PARAM);
  const model: PricingModel | "" = isPricingModel(modelParam) ? modelParam : "";
  const standard = searchParams.get(STANDARD_PARAM) ?? "";
  const sortParam = searchParams.get(SORT_PARAM);
  const sort: ListingSort = isListingSort(sortParam) ? sortParam : DEFAULT_LISTING_SORT;
  const page = readPageNumber(searchParams.get(PAGE_PARAM));

  // A caller could hand this component a total it cannot page through; the last page and the range
  // are computed from a non-negative one, so both stay sane whatever arrives.
  const total = Number.isFinite(props.total) && props.total > 0 ? Math.floor(props.total) : 0;
  const lastPage = total === 0 ? 1 : Math.ceil(total / LISTING_PAGE_SIZE);

  const [queryInput, setQueryInput] = useState<string>(query);
  const [pageInput, setPageInput] = useState<string>(String(page));
  const [pageError, setPageError] = useState<string | null>(null);

  const commit = useCallback(
    (key: string, value: string): void => {
      const next = new URLSearchParams(searchParams);
      if (value === "" || (key === PAGE_PARAM && value === "1")) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (key !== PAGE_PARAM) {
        next.delete(PAGE_PARAM);
      }
      // An identical write would only add a history entry the reader has to step back through.
      if (next.toString() === searchParams.toString()) {
        return;
      }
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  // The URL is the source of truth for every committed value, so a change made outside this
  // component — a followed link, the back button — flows into the box as well.
  useEffect((): void => {
    setQueryInput(query);
  }, [query]);

  // A keystroke is not a view: the box writes the URL once typing pauses, and a submit writes it at
  // once. One write per character would bury the previous view under a history entry each.
  useEffect((): void | (() => void) => {
    if (queryInput === query) {
      return;
    }
    const timer = window.setTimeout((): void => {
      commit(QUERY_PARAM, queryInput);
    }, QUERY_DEBOUNCE_MS);
    return (): void => {
      window.clearTimeout(timer);
    };
  }, [queryInput, query, commit]);

  useEffect((): void => {
    setPageInput(String(page));
    setPageError(null);
  }, [page]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    commit(QUERY_PARAM, queryInput);
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setQueryInput(event.target.value);
  };

  // Each select carries the query parameter it writes as its name, so one handler serves all five.
  const handleFilterChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    commit(event.target.name, event.target.value);
  };

  const handlePageNumberChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    setPageInput(raw);
    if (raw.trim() === "") {
      // An emptied box is a value on its way in, not a mistake to report.
      setPageError(null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setPageError(PAGE_ERROR_MESSAGE);
      return;
    }
    setPageError(null);
    commit(PAGE_PARAM, String(parsed));
  };

  const handlePageNumberKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // A number field discards a character it cannot hold and fires no change event, so the keystroke
    // is the only place that refusal can be seen; anything that is not a single character, and every
    // paste or editing shortcut, is left to the field itself.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key.length === 1 && !DIGIT_PATTERN.test(event.key)) {
      setPageError(PAGE_ERROR_MESSAGE);
    }
  };

  const handlePreviousPage = (): void => {
    commit(PAGE_PARAM, String(Math.max(1, page - 1)));
  };

  const handleNextPage = (): void => {
    commit(PAGE_PARAM, String(Math.min(lastPage, page + 1)));
  };

  const queryFieldId = `${idPrefix}-q`;
  const categoryFieldId = `${idPrefix}-category`;
  const licenseFieldId = `${idPrefix}-license`;
  const modelFieldId = `${idPrefix}-model`;
  const standardFieldId = `${idPrefix}-standard`;
  const sortFieldId = `${idPrefix}-sort`;
  const pageFieldId = `${idPrefix}-page`;
  const pageHintId = `${idPrefix}-page-hint`;
  const pageErrorId = `${idPrefix}-page-error`;

  const pageHint =
    total === 0
      ? "There is nothing to page through yet."
      : `Enter a page number from 1 to ${lastPage}.`;

  return (
    <form
      className="search-filters"
      role="search"
      aria-label="Search and filter listings"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="field">
        <label className="field__label" htmlFor={queryFieldId}>
          Search listings
        </label>
        {/* A search query has no autofill purpose, so this box declares none rather than claiming a
            purpose it does not have. */}
        <input
          id={queryFieldId}
          type="search"
          value={queryInput}
          onChange={handleQueryChange}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={categoryFieldId}>
          Category
        </label>
        <select
          id={categoryFieldId}
          name={CATEGORY_PARAM}
          value={category}
          onChange={handleFilterChange}
        >
          <option value="">All categories</option>
          {renderOptions(optionsWithActive(props.categories, category))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={licenseFieldId}>
          License
        </label>
        <select
          id={licenseFieldId}
          name={LICENSE_PARAM}
          value={license}
          onChange={handleFilterChange}
        >
          <option value="">All licenses</option>
          {renderOptions(optionsWithActive(props.licenses, license))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={modelFieldId}>
          Pricing model
        </label>
        <select id={modelFieldId} name={MODEL_PARAM} value={model} onChange={handleFilterChange}>
          <option value="">All pricing models</option>
          {renderOptions(PRICING_MODEL_OPTIONS)}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={standardFieldId}>
          Standard
        </label>
        <select
          id={standardFieldId}
          name={STANDARD_PARAM}
          value={standard}
          onChange={handleFilterChange}
        >
          <option value="">Any standard</option>
          {renderOptions(optionsWithActive(props.standards, standard))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={sortFieldId}>
          Sort by
        </label>
        <select id={sortFieldId} name={SORT_PARAM} value={sort} onChange={handleFilterChange}>
          {renderOptions(SORT_OPTIONS)}
        </select>
      </div>

      <div className={pageError === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={pageFieldId}>
          Page
        </label>
        <input
          id={pageFieldId}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={pageInput}
          onChange={handlePageNumberChange}
          onKeyDown={handlePageNumberKeyDown}
          aria-invalid={pageError !== null}
          aria-describedby={pageError === null ? pageHintId : pageErrorId}
        />
        {pageError === null ? (
          <p className="field__hint" id={pageHintId}>
            {pageHint}
          </p>
        ) : (
          <p className="field__error" id={pageErrorId}>
            {pageError}
          </p>
        )}
        <div className="field__group">
          <button
            type="button"
            className="button button--secondary"
            onClick={handlePreviousPage}
            disabled={page <= 1}
          >
            Previous
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={handleNextPage}
            disabled={page >= lastPage}
          >
            Next
          </button>
        </div>
        <p className="status-region" role="status">
          {describePage(total, page, lastPage)}
        </p>
      </div>

      <button type="submit" className="button button--primary">
        Search
      </button>
    </form>
  );
}
