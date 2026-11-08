/**
 * The `page` query parameter of a bounded collection read.
 *
 * Attach it to every row whose success response carries a collection that grows with use:
 * `GET /audit-events`, the three `GET /ledger/*` rows, `GET /challenges`, `GET /threads`,
 * `GET /standards` and `GET /listings/{id}`. Each of those reads answers with one page of
 * COLLECTION_PAGE_SIZE rows — page 1 carrying the most recent page of the
 * collection, and each page holding its own rows in the order that read documents — and
 * each states the page it answered and the number of rows the whole collection holds, so a
 * client reaches the rest by asking for the next page rather than by receiving the whole
 * table in one response.
 *
 * `page` is declared `integer` with a lower bound of `1` and an upper bound of
 * `PAGE_NUMBER_MAX` (`../constants`), both of them this schema's own constraint, so no page
 * reaches the arithmetic that turns it into an offset outside the range that arithmetic
 * states exactly. The listing search declares the lower bound alone and judges the upper end
 * of its own page in its route, because there the refusal is about the offset the store is
 * handed rather than about a value a query schema can settle. The validator coerces the query string
 * to a number and fills the default, so the parsed query always carries a number and no
 * route re-defaults or re-parses it. The page number is the only paging input: there is no
 * offset, no cursor and no page size, so the fixed COLLECTION_PAGE_SIZE cannot be raised
 * from a request — a `?limit=`, `?pageSize=` or `X-Page-Size:` attempt is simply not part
 * of this schema.
 *
 * `additionalProperties: false` is what makes an unexpected query key harmless rather than
 * a refusal: Fastify's validator removes an unknown key before the handler runs, exactly as
 * it does on the search row, so `?unknown=1` neither widens this contract nor answers a
 * `400`. A `400` comes from a value that fails a constraint — `?page=0`, `?page=-1`,
 * `?page=abc`, or a page above `PAGE_NUMBER_MAX` — which is the same "invalid parameter"
 * refusal the search row documents.
 *
 * Request side only: this module declares no response schema, because a route's body is
 * built by the handler that owns it and no response is filtered here.
 */

import { PAGE_NUMBER_MAX } from '../constants';

/**
 * The query contract of a bounded collection read, spread together with that row's own
 * header and parameter schemas by the route that attaches it.
 *
 * The identifier is named for what it bounds rather than for one row, because eight rows
 * share this one parameter: one definition is what keeps the eight refusing the same
 * values and answering the same shape.
 */
export const collectionPageQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, maximum: PAGE_NUMBER_MAX, default: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * The parsed query of a bounded collection read, as it reaches a handler.
 *
 * `page` is required rather than optional because the schema's default fills it: the
 * validator resolves it before the handler runs, so a handler that defaulted it again would
 * be stating a second answer to one question. A route reads it and nothing else from the
 * query, which is why no other member is declared.
 */
export interface CollectionPageQuery {
  /** The 1-based page of the read's collection to answer, resolved from the schema's default
   * and constrained by the schema to at most {@link PAGE_NUMBER_MAX}. */
  readonly page: number;
}
