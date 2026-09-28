import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { generateSeedData } from "../../db/seed-data.js";
import { createQueryCustomersTool } from "./query-customers.js";

const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "");
const logger = pino({ level: "silent" });
const seed = generateSeedData();
const tool = createQueryCustomersTool({ db, logger });

afterAll(async () => {
  await pool.end();
});

async function call(input: Record<string, unknown>) {
  return JSON.parse(await tool.invoke(input));
}

const first = seed.customers[0];
if (!first) throw new Error("seed has no customers");

describe("query_customers", () => {
  it("is named and described for the model", () => {
    expect(tool.name).toBe("query_customers");
    expect(tool.description).toContain("Use for");
    expect(tool.description).toContain("Do NOT use for");
  });

  it("tells the model that id is a whole number", () => {
    expect(tool.schema.shape.id.description).toContain("whole number");
  });

  it("returns the first 20 customers when no filter is given", async () => {
    const result = await call({});
    expect(result).toMatchObject({ ok: true, total: 20, truncated: false });
    expect(result.rows).toHaveLength(20);
  });

  it("finds one customer by id", async () => {
    const result = await call({ id: first.id });
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: first.id,
        name: first.name,
        email: first.email,
      }),
    ]);
  });

  it("matches part of a name in any letter case", async () => {
    const part = first.name.slice(0, 4).toUpperCase();
    const result = await call({ name: part });
    expect(result.rows.map((row: { id: number }) => row.id)).toContain(
      first.id,
    );
  });
});

describe("query_customers filters", () => {
  it("matches email, city and country exactly but in any letter case", async () => {
    const byEmail = await call({ email: first.email.toUpperCase() });
    expect(byEmail.total).toBe(1);
    const expected = seed.customers.filter((c) => c.city === first.city).length;
    expect((await call({ city: first.city.toLowerCase() })).total).toBe(
      expected,
    );
    expect((await call({ city: first.city.slice(0, 3) })).total).toBe(0);
    const inCountry = seed.customers.filter(
      (c) => c.country === first.country,
    ).length;
    expect((await call({ country: first.country })).total).toBe(inCountry);
  });

  it("combines filters with AND", async () => {
    const other = seed.customers.find((c) => c.city !== first.city);
    const result = await call({ name: first.name, city: other?.city });
    expect(result).toMatchObject({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
    });
  });

  it("reports the full total when the limit cuts rows off", async () => {
    const result = await call({ limit: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result).toMatchObject({ total: 20, truncated: true });
  });

  it("treats null filters as not set", async () => {
    const result = await call({
      id: null,
      name: null,
      city: null,
      limit: null,
    });
    expect(result.total).toBe(20);
  });

  it("matches wildcard characters literally", async () => {
    expect((await call({ name: "%" })).total).toBe(0);
    expect((await call({ name: "_" })).total).toBe(0);
  });

  it("rejects input that does not fit the schema", async () => {
    await expect(tool.invoke({ limit: 101 })).rejects.toThrow();
    // Deliberately the wrong type, to check the runtime schema check: the
    // model can send anything, and TypeScript cannot see that at build time.
    await expect(tool.invoke({ id: "one" } as never)).rejects.toThrow();
  });
});

describe("query_customers filters sent as text", () => {
  it("finds the same customer whether id is a number or that number as text", async () => {
    const byNumber = await call({ id: first.id });
    const byText = await call({ id: String(first.id) });
    expect(byText).toEqual(byNumber);
  });

  it("returns one row when limit is sent as text", async () => {
    const result = await call({ name: first.name, limit: "1" });
    expect(result.rows).toHaveLength(1);
  });
});
