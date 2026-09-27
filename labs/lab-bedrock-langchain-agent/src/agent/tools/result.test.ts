import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { products } from "../../db/schema.js";
import { limitField, READ_ONLY, readRows } from "./result.js";

const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "");
const logger = pino({ level: "silent" });

afterAll(async () => {
  await pool.end();
});

describe("readRows", () => {
  it("returns rows, the total before the limit, and the truncated flag", async () => {
    const text = await readRows({
      db,
      logger,
      tool: "probe",
      limit: 4,
      query: (tx, limit) => tx.select().from(products).limit(limit),
      count: (tx) => tx.$count(products),
    });
    const result = JSON.parse(text);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(4);
    expect(result.total).toBe(15);
    expect(result.truncated).toBe(true);
  });

  it("returns a structured error instead of throwing", async () => {
    const text = await readRows({
      db,
      logger,
      tool: "probe",
      limit: 4,
      query: () => Promise.reject(new Error("connection lost at 10.0.0.5")),
      count: () => Promise.resolve(0),
    });
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: {
        code: "DATABASE_ERROR",
        message: "The database query failed. Try again or use other filters.",
      },
    });
  });
});

describe("READ_ONLY", () => {
  it("makes the database refuse a write", async () => {
    await expect(
      db.transaction(
        (tx) =>
          tx
            .insert(products)
            .values({ name: "X", category: "Office", priceCents: 1, stock: 1 }),
        READ_ONLY,
      ),
    ).rejects.toThrow();
    expect(await db.$count(products)).toBe(15);
  });
});

describe("limitField", () => {
  it("defaults to 20 and treats null as the default", () => {
    expect(limitField.parse(undefined)).toBe(20);
    expect(limitField.parse(null)).toBe(20);
  });

  it.each([0, 101, 1.5])("rejects %s", (value) => {
    expect(limitField.safeParse(value).success).toBe(false);
  });

  it("accepts the maximum of 100", () => {
    expect(limitField.parse(100)).toBe(100);
  });
});
