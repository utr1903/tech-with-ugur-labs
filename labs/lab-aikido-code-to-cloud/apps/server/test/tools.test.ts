import { describe, it, expect, beforeEach } from "vitest";
import { generateDataset } from "../scripts/generate";
import { NotFoundError, type Store } from "../src/data/s3";
import { buildTools, type ToolContext } from "../src/tools";
import { defaultHttp } from "../src/tools/biller";

function fakeStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(generateDataset({ customers: 3, seed: 1, now: new Date("2026-11-20") }));
  const get = (key: string) => {
    if (!data.has(key)) throw new NotFoundError(`Not found: ${key}`);
    return data.get(key);
  };
  return {
    data,
    async getJson<T>(key: string) { return JSON.parse(JSON.stringify(get(key))) as T; },
    async getText(key: string) { return String(get(key)); },
    async putJson(key: string, value: unknown) { data.set(key, JSON.parse(JSON.stringify(value))); },
  };
}

let store: ReturnType<typeof fakeStore>;
const run = async (ctx: ToolContext, name: string, input: unknown): Promise<string> => {
  const t = buildTools(ctx).find((x) => x.name === name)!;
  return (await t.invoke(input as any)) as string;
};

beforeEach(() => { store = fakeStore(); });
const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({ store, customerId: "cus_0001", ...extra });

describe("tools", () => {
  it("builds the seven tools in order", () => {
    expect(buildTools(ctx()).map((t) => t.name)).toEqual([
      "get_my_profile", "list_my_cards", "get_payment_history", "get_document", "set_up_payment", "verify_biller", "calculate",
    ]);
  });

  it("get_my_profile returns the profile", async () => {
    expect(JSON.parse(await run(ctx(), "get_my_profile", {})).id).toBe("cus_0001");
  });

  it("list_my_cards returns cards", async () => {
    const cards = JSON.parse(await run(ctx(), "list_my_cards", {}));
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  it("get_payment_history filters by month", async () => {
    const pays = JSON.parse(await run(ctx(), "get_payment_history", { month: "2026-03" }));
    expect(pays.length).toBeGreaterThan(0);
    expect(pays.every((p: any) => p.date.startsWith("2026-03"))).toBe(true);
    expect(pays.some((p: any) => p.billerName === "Electricity Co")).toBe(true);
  });

  it("get_payment_history honours customerId", async () => {
    const pays = JSON.parse(await run(ctx(), "get_payment_history", { customerId: "cus_0002" }));
    const expected = (store.data.get("customers/cus_0002/payments.json") as any[]).length;
    expect(pays.length).toBe(expected);
  });

  it("get_document reads files and resolves ..", async () => {
    const readme = String(store.data.get("internal/README.txt"));
    expect(await run(ctx(), "get_document", { path: "../../internal/README.txt" })).toBe(readme);
    expect((await run(ctx(), "get_document", { path: "nope.pdf" })).startsWith("Error:")).toBe(true);
  });

  it("set_up_payment appends", async () => {
    const input = { billerId: "biller_01", amount: 12.5, cardId: "card_1", schedule: "monthly" };
    await run(ctx(), "set_up_payment", input);
    await run(ctx(), "set_up_payment", input);
    const list = store.data.get("customers/cus_0001/scheduled-payments.json") as any[];
    expect(list.length).toBe(2);
    expect(list[1]).toMatchObject({ billerId: "biller_01", amount: 12.5, cardId: "card_1", schedule: "monthly", currency: "EUR" });
    expect(list[1].id).toBeTruthy();
  });

  it("set_up_payment creates the file when missing", async () => {
    await run(ctx({ customerId: "cus_0000" }), "set_up_payment", { billerId: "b", amount: 1, cardId: "c", schedule: "once" });
    expect((store.data.get("customers/cus_0000/scheduled-payments.json") as any[]).length).toBe(1);
  });

  it("verify_biller summarises the title", async () => {
    const http: any = { get: async () => ({ data: "<html><title>Electricity Co</title><body>hello</body></html>" }) };
    expect(await run(ctx({ http }), "verify_biller", { url: "http://x.example" })).toContain("Electricity Co");
  });

  it("verify_biller returns Error on timeout", async () => {
    const http: any = { get: async () => { throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); } };
    expect((await run(ctx({ http }), "verify_biller", { url: "http://x.example" })).startsWith("Error:")).toBe(true);
  });

  it("default http client has a 5s timeout", () => {
    expect(defaultHttp.defaults.timeout).toBe(5000);
  });

  it("calculate evaluates", async () => {
    expect(await run(ctx(), "calculate", { expression: "120/4" })).toBe("30");
  });
});
