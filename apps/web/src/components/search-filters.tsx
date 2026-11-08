/**
 * The listings search and filter controls: the query box, the four filters and the ordering.
 *
 * **The URL is the state.** Every control reads its value from the query string and writes a changed
 * value straight back to it, so a filtered view is a link a buyer can send, the back button steps
 * through the filters that were applied, and the listings page can state an empty result together
 * with the filters that produced it. A `q`, `category`, `license`, `model`, `standard` or `sort` kept
 * anywhere else would not survive a copy of the address.
 *
 * Two rules the controls keep.
 *
 * - **A changed filter drops `page`.** A stale page number against a narrower result set shows an
 *   empty list that reads as "no such listing" when the truth is "not on this page". Page 1 is the
 *   server's own default, so the parameter is omitted rather than written, and a filtered view's URL
 *   then carries only the filters that produced it.
 * - **Clearing a filter removes its parameter** rather than writing an empty value, so the page can
 *   tell an absent filter from a cleared one.
 *
 * **Paging belongs to the results region, and carries one control.** That region states the range and
 * the last page and holds the pager, so this form offers one action per control: a second
 * Previous/Next pair or a page-number box here would move the same `page` parameter under a second
 * vocabulary, and a reader could not tell which of the two the page follows.
 *
 * Presentation only: no request, no storage, no cookie. The category, license and standard options
 * arrive as props because the contract exposes no endpoint that lists categories or licenses — the
 * page derives those from what it already received. The form takes no native validation, and a whole
 * request the server refuses is the page's to render.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULT_LISTING_SORT, LISTING_SORTS, PRICING_MODELS } from "@adem/shared";
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

/** The paging parameter: this component never writes it, it only drops a stale one. */
const PAGE_PARAM = "page";

/** How long the query box waits after the last keystroke before it writes the URL. */
const QUERY_DEBOUNCE_MS = 300;

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
 * Props for {@link SearchFilters}. All three are required: `exactOptionalPropertyTypes` is on, so a
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
 * The filter bar above the listings: the query box, the four filters and the ordering, all held in
 * the URL. Paging is the results region's own control, so nothing here writes the page number.
 *
 * Rendering and the query string only — it sends no request and stores nothing.
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

  const [queryInput, setQueryInput] = useState<string>(query);

  const commit = useCallback(
    (key: string, value: string): void => {
      const next = new URLSearchParams(searchParams);
      if (value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // A changed filter drops the page: a stale page number against a narrower result set shows an
      // empty list that reads as "no such listing" when the truth is "not on this page". Page 1 is the
      // server's own default, so the parameter is omitted rather than written.
      next.delete(PAGE_PARAM);
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

  const queryFieldId = `${idPrefix}-q`;
  const categoryFieldId = `${idPrefix}-category`;
  const licenseFieldId = `${idPrefix}-license`;
  const modelFieldId = `${idPrefix}-model`;
  const standardFieldId = `${idPrefix}-standard`;
  const sortFieldId = `${idPrefix}-sort`;

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

      <button type="submit" className="button button--primary">
        Search
      </button>
    </form>
  );
}
