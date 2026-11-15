/**
 * The integration proof of `registerSponsoredRoutes` from `apps/api/src/routes/sponsored.ts`: the
 * public `GET /sponsored-slots` read, which is the whole of ADEM's advertising surface.
 *
 * What it evidences, in the terms the plan states them:
 *
 * - **The contract row.** `200` with a body carrying `items` and nothing else, and every item
 *   carrying the marker `sponsored: true` — asserted strictly, never for truthiness, because a
 *   renderer that took this collection for organic content is the defect the marker exists to stop.
 * - **The total order `placement_key ASC, id ASC`.** The rows go in reversed, and two of them share
 *   one placement key, so the insertion order and the answer differ in both dimensions: a slot
 *   returned in the order it was written, or without the `id` tie-break, fails here.
 * - **Determinism.** A second call answers a byte-identical body.
 * - **An empty table.** `200` with `items: []`, which is an ordinary answer rather than an error.
 * - **No identity.** An absent header, a garbage header and a header naming another role all answer
 *   alike, the row's role being public.
 * - **No other method.** `PUT`, `PATCH` and `DELETE` answer `404`, the behaviour of an unregistered
 *   method, because this group registers only the `GET` the contract lists.
 *
 * The group is registered inside the `/api/v1` prefix exactly as the composition root registers it,
 * against a real migrated `:memory:` handle, and the rows go in through a real `INSERT`: what is
 * under test is the read the contract describes, not a stub of it.
 */

import Database from "better-sqlite3";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SponsoredSlot, SponsoredSlotListItem, SponsoredSlotListResult } from "@adem/shared";

import { runMigrations } from "../../src/db/migrate";
import { registerSponsoredRoutes } from "../../src/routes/sponsored";
import { SEED_BUYER_ACCOUNT_ID, SEED_SPONSORED_SLOTS } from "../../src/seed/seed-data";

/** The path the read is registered at once the composition root's version prefix is applied. */
const SPONSORED_SLOTS_URL = "/api/v1/sponsored-slots";

/** The one insert path into `sponsored_slots`, stated here as the table declares its columns. */
const INSERT_SLOT_SQL =
  "INSERT INTO sponsored_slots (id, sponsor_label, placement_key, fee_minor_units, created_at) " +
  "VALUES (?, ?, ?, ?, ?)";

/**
 * Two more slots beside the seeded pair, both on `home`.
 *
 * They are what makes the order the answer's own rather than the insertion's: with them the table
 * holds three `home` slots, so the `id` tie-break decides between them, and their ids sort after the
 * seeded `home` slot while being written before it.
 */
const EXTRA_SLOTS: readonly SponsoredSlot[] = Object.freeze([
  Object.freeze({
    id: "spon0003-6c5d-9e4f-8a3b-c4d5e6f7a8b9",
    sponsor_label: "Demo Freight Line",
    placement_key: "home",
    fee_minor_units: 1800,
    created_at: "2024-03-19T11:00:00.000Z",
  }),
  Object.freeze({
    id: "spon0004-7d6e-9f5a-8b4c-d5e6f7a8b9ca",
    sponsor_label: "Sample Depot",
    placement_key: "home",
    fee_minor_units: 700,
    created_at: "2024-03-19T11:30:00.000Z",
  }),
]);

/** Every row this file puts in the table: the two the seed ships and the two above. */
const ALL_SLOTS: readonly SponsoredSlot[] = Object.freeze([...SEED_SPONSORED_SLOTS, ...EXTRA_SLOTS]);

/**
 * The ids of those rows in the order `placement_key ASC, id ASC` fixes: the three `home` slots first,
 * tie-broken by id, then the single `listings` slot.
 *
 * Written out in answer order rather than sorted here, so this line states what the read must answer
 * instead of being a second copy of the query.
 */
const EXPECTED_ORDER: readonly string[] = Object.freeze([
  "spon0001-4a3b-9c2d-8e1f-a1b2c3d4e5f6",
  "spon0003-6c5d-9e4f-8a3b-c4d5e6f7a8b9",
  "spon0004-7d6e-9f5a-8b4c-d5e6f7a8b9ca",
  "spon0002-5b4c-9d3e-8f2a-c3d4e5f6a7b8",
]);

/** The rows keyed by id, so the expectation below is built from the rows the table really holds. */
const ROWS_BY_ID = new Map<string, SponsoredSlot>(ALL_SLOTS.map((slot) => [slot.id, slot]));

/** Every handle and instance this file opened, closed in `afterAll`. */
const databases: Database.Database[] = [];
const apps: FastifyInstance[] = [];

/** Opens a fresh in-memory database of this file's own and records it for cleanup. */
function newDatabase(): Database.Database {
  const handle = new Database(":memory:");
  databases.push(handle);
  return handle;
}

/**
 * Registers the group inside the versioned prefix, exactly as the composition root does, and waits
 * until the instance is ready to answer.
 */
async function registerAppWith(handle: Database.Database): Promise<FastifyInstance> {
  const instance = Fastify();
  instance.register(
    async (scope) => {
      registerSponsoredRoutes(scope, { database: handle });
    },
    { prefix: "/api/v1" },
  );
  await instance.ready();
  apps.push(instance);
  return instance;
}

/** Writes the given rows into `sponsored_slots` in the order given. */
function insertSlots(handle: Database.Database, rows: readonly SponsoredSlot[]): void {
  const insert = handle.prepare<[string, string, string, number, string]>(INSERT_SLOT_SQL);
  for (const row of rows) {
    insert.run(row.id, row.sponsor_label, row.placement_key, row.fee_minor_units, row.created_at);
  }
}

/** One stored row as the item the public read answers with: its own fields plus the marker. */
function toItem(row: SponsoredSlot): SponsoredSlotListItem {
  return { ...row, sponsored: true };
}

/** The row an expected id belongs to, or an error naming the id, since a missing row is a defect. */
function rowById(id: string): SponsoredSlot {
  const row = ROWS_BY_ID.get(id);
  if (row === undefined) {
    throw new Error(`this suite expects a slot row with the id ${id}, and none was loaded`);
  }
  return row;
}

/** The items the read must answer with, in the order {@link EXPECTED_ORDER} fixes. */
const EXPECTED_ITEMS: readonly SponsoredSlotListItem[] = Object.freeze(
  EXPECTED_ORDER.map((id) => toItem(rowById(id))),
);

/** The seeded handle and the instance the read is registered on. */
let app: FastifyInstance;

beforeAll(async () => {
  const database = newDatabase();
  runMigrations(database);
  // Reversed on purpose: the insertion order is the answer's order backwards, so a read that
  // returned rows as they were written would answer a different array.
  insertSlots(database, [...ALL_SLOTS].reverse());
  app = await registerAppWith(database);
});

afterAll(async () => {
  for (const instance of apps.splice(0)) {
    await instance.close();
  }
  for (const handle of databases.splice(0)) {
    if (handle.open) {
      handle.close();
    }
  }
});

describe("GET /sponsored-slots", () => {
  it("answers every stored slot as a labelled collection in placement_key, id order", async () => {
    const response = await app.inject({ method: "GET", url: SPONSORED_SLOTS_URL });

    expect(response.statusCode).toBe(200);
    const body = response.json<SponsoredSlotListResult>();

    // The body is the collection and nothing else: no paging shape, no total, no marker of its own.
    expect(Object.keys(body)).toStrictEqual(["items"]);
    expect(body.items).toHaveLength(ALL_SLOTS.length);
    expect(body.items).toStrictEqual(EXPECTED_ITEMS);

    // The marker as its own assertion, because the strict comparison above would also pass if a
    // truthy value had found its way in where the literal belongs.
    for (const item of body.items) {
      expect(typeof item.sponsored).toBe("boolean");
      expect(item.sponsored).toStrictEqual(true);
    }
  });

  it("answers a byte-identical body on a second call", async () => {
    const first = await app.inject({ method: "GET", url: SPONSORED_SLOTS_URL });
    const second = await app.inject({ method: "GET", url: SPONSORED_SLOTS_URL });

    expect(second.statusCode).toBe(200);
    expect(second.payload).toBe(first.payload);
  });

  it("resolves no identity: an absent, garbage or other-role header answer alike", async () => {
    const absent = await app.inject({ method: "GET", url: SPONSORED_SLOTS_URL });
    const garbage = await app.inject({
      method: "GET",
      url: SPONSORED_SLOTS_URL,
      headers: { "x-demo-account": "no-account-carries-this-value" },
    });
    const otherRole = await app.inject({
      method: "GET",
      url: SPONSORED_SLOTS_URL,
      // A buyer's account id: the row's role is public, so no role is required of the caller and no
      // `accounts` row has to exist for this header, because the read resolves no identity at all.
      headers: { "x-demo-account": SEED_BUYER_ACCOUNT_ID },
    });

    for (const response of [absent, garbage, otherRole]) {
      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe(absent.payload);
    }
  });

  it("answers an empty table with the empty collection rather than an error", async () => {
    const database = newDatabase();
    runMigrations(database);
    const emptyApp = await registerAppWith(database);

    const response = await emptyApp.inject({ method: "GET", url: SPONSORED_SLOTS_URL });

    expect(response.statusCode).toBe(200);
    const body = response.json<SponsoredSlotListResult>();
    expect(Object.keys(body)).toStrictEqual(["items"]);
    expect(body.items).toStrictEqual([]);
  });

  it("answers no other method: PUT, PATCH and DELETE are 404, as an unregistered method is", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const response = await app.inject({ method, url: SPONSORED_SLOTS_URL });

      expect(response.statusCode).toBe(404);
    }
  });
});
