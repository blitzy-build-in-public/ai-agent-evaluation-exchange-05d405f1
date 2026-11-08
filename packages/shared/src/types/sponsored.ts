/**
 * The sponsored-slot vocabulary: the two surfaces a labelled sponsored block may sit
 * on, the slot record the public read returns, and the separate collection that read
 * answers with.
 *
 * Four properties of this module are structural rather than conventional, and each one
 * is why a field is declared the way it is:
 *
 * - **A sponsorship reaches no measurement.** A `sponsored_slots` row is stored apart
 *   from every SGI table, no SGI query joins it, and no type here is referenced by an
 *   SGI type — the sibling `report.ts`, `standard.ts` and `appeal.ts` import nothing
 *   from this module. A sponsorship therefore cannot influence an evaluation, a badge
 *   or the organic order of a listing, and that holds because no path exists rather
 *   than because a caller remembers not to take one.
 * - **A slot's fee is not eligible for a founder allocation.** The allocation applies
 *   to the net amount of an eligible completed simulated marketplace transaction and
 *   to nothing else: neither {@link SponsoredSlot.fee_minor_units} nor a gate fee
 *   enters it.
 * - **A slot holds no identifier for a reader.** No field here, and no column behind
 *   one, carries anything about the person who saw an item or opened it, or any count
 *   of either — the product does no personalized advertising profiling and keeps no
 *   per-reader counters. A sponsored item is labelled; it is not measured.
 * - **The placement vocabulary is closed.** A sponsored block may sit on the home page
 *   and on the listings page, below that page's organic results and never interleaved
 *   with them.
 *
 * The words the reader sees are copy, owned by `../constants`: `SPONSORED_LABEL` is
 * the literal `"Sponsored"`, rendered by `apps/web/src/components/sponsored-label.tsx`
 * on every sponsored item, and `SYNTHETIC_CURRENCY_LABEL` names the currency a fee is
 * counted in. This module types values and restates none of them.
 *
 * Declarations only: no placement, ordering or fee arithmetic lives here. Which block
 * renders where is the UI's choice, and every amount in the product is computed by
 * `packages/commerce-sim` from its own configuration — including the single half-up
 * allocation in `packages/commerce-sim/src/ledgers/allocate.ts`, which no fee of this
 * module ever reaches.
 *
 * Property names are snake_case so the `sponsored_slots` column, the JSON payload and
 * this type share one spelling. Every string named is fictional demo content: no real
 * brand, no real personal name, no contact detail and no real currency code or symbol
 * appears anywhere in the product.
 */

import type { MinorUnits } from "./commerce";

/**
 * The two surfaces a labelled sponsored block may be placed on: the home page and the
 * listings page, each rendering the block below its own organic results.
 *
 * The vocabulary is closed to these two. A third surface is a plan revision rather
 * than an implementation choice, because each new surface needs its own disclosure
 * decision — where its block sits relative to the organic results and what sits beside
 * it — and a placement that acquired a key without one would be a surface rendering
 * sponsored content that nothing labels.
 */
export const SPONSORED_PLACEMENT_KEYS = ["home", "listings"] as const;

/**
 * One surface from {@link SPONSORED_PLACEMENT_KEYS}, derived from the tuple rather
 * than restated, so the placement vocabulary has exactly one definition in the
 * repository and a slot cannot name a surface the product does not render.
 */
export type SponsoredPlacementKey = (typeof SPONSORED_PLACEMENT_KEYS)[number];

/**
 * One row of the `sponsored_slots` table: a limited sponsor-slot demonstration, held
 * as seed data and read by the public `GET /sponsored-slots`. No route creates, updates
 * or deletes a slot, so a slot changes only by a new seed — which is why the row
 * carries no status, no publication date and no updated-at field.
 *
 * The record is deliberately thin, and each omission is itself the guarantee:
 *
 * - It holds no SGI reference of any kind — no standard version, no report, no outcome
 *   — and no SGI query joins this table, so a sponsorship can be read neither as
 *   evidence about an agent nor as an input to a measurement. The separation is
 *   checked statically across every import specifier in `packages/sgi-core` and again
 *   by varying sponsorship and asserting that reports, badges and the organic order
 *   come back unchanged.
 * - It holds no reader identifier and no count of times an item was seen or opened.
 *   The demonstration is labelled advertising with no personalized profiling behind
 *   it, which is why nothing here could hold a reader's identity even if a later
 *   change wanted it to.
 * - It holds no entitlement, beneficiary or payability field. The fee is a fictional
 *   amount of the synthetic currency, journalled by no ledger, and it is never eligible
 *   for the founder allocation described on {@link SponsoredSlot.fee_minor_units}.
 * - It holds no target address and no campaign reference: a sponsored item states what
 *   it is and links nowhere.
 */
export interface SponsoredSlot {
  /** Identifier of the slot, unique among the sponsored slots. */
  id: string;
  /**
   * The fictional label of the sponsor, rendered beside the item it belongs to. Both
   * halves of that phrase matter: it is demo content that names no real brand and no
   * real person, so it identifies an entry in a demonstration rather than an
   * organisation the product could be asked to deal with.
   */
  sponsor_label: string;
  /**
   * The surface the slot belongs to, one of {@link SPONSORED_PLACEMENT_KEYS}. It is
   * what lets a page render the block that is its own and leave the other surface's
   * slots to that surface.
   */
  placement_key: SponsoredPlacementKey;
  /**
   * The fictional fee for the slot, in whole minor units of the synthetic currency:
   * an integer count like every other amount in the product, never a fraction and
   * never a real currency code or symbol.
   *
   * The fee is what makes the item advertising, and it stops there. It is not eligible
   * for a founder allocation — only the net amount of an eligible completed simulated
   * marketplace transaction is — and it changes nothing a buyer reads about an agent:
   * no outcome, no badge, no position in the organic results.
   */
  fee_minor_units: MinorUnits;
  /** ISO-8601 UTC instant the slot was seeded, written at insert time. */
  created_at: string;
}

/**
 * One item of the public `GET /sponsored-slots` response: a {@link SponsoredSlot} plus
 * the marker every item of that collection carries.
 *
 * `sponsored` is the literal `true` rather than a boolean on purpose. An item that is
 * not marked cannot be typed at all, so a component mapping this collection cannot
 * render a sponsored item as though it were an organic one, and the marking is a
 * property of the type rather than an instruction a renderer is asked to remember.
 *
 * The label the reader sees is the copy constant `SPONSORED_LABEL` in `../constants`,
 * whose value is the literal `"Sponsored"`, rendered by
 * `apps/web/src/components/sponsored-label.tsx` on every sponsored item.
 */
export interface SponsoredSlotListItem extends SponsoredSlot {
  sponsored: true;
}

/**
 * The body of the public `GET /sponsored-slots` response: the sponsored items and
 * nothing else.
 *
 * This type carries no paging shape — no `total`, no `page`, no page size — and that
 * absence states what the collection is. It is not a page of a search result but a
 * separate, labelled block, which the home page and the listings page render below
 * their organic results and never interleaved with them. A sponsored item is not a
 * listing kind: the sibling `listing.ts` search result declares no field that could
 * hold one, so neither payload can absorb the other.
 *
 * Being returned here says nothing about merit. A sponsorship never influences the
 * organic order, appears in no badge and reaches no SGI measurement; the collection is
 * rendered beside the organic results precisely so a reader can tell the two apart.
 */
export interface SponsoredSlotListResult {
  /**
   * The sponsored items the read answers with, one entry per slot it carries: an empty array is a
   * complete answer, so the pages that render this block render nothing when it is empty rather
   * than an empty frame.
   */
  items: SponsoredSlotListItem[];
}
