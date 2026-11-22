import { describe, it, expect } from "vitest";
import { generateDataset, DEMO_USERS } from "../scripts/generate";
import { luhnValid } from "../scripts/luhn";

const now = new Date("2026-11-20");
const opts = { customers: 25, seed: 42, now };
const ds = generateDataset(opts);
const get = <T>(k: string) => ds.get(k) as T;
const ids = Array.from({ length: 25 }, (_, i) => `cus_${String(i + 1).padStart(4, "0")}`);

describe("generateDataset", () => {
  it("is deterministic per seed", () => {
    expect(JSON.stringify([...generateDataset(opts)])).toEqual(JSON.stringify([...ds]));
    expect(JSON.stringify([...generateDataset({ ...opts, seed: 43 })])).not.toEqual(JSON.stringify([...ds]));
  });

  it("has the expected keys", () => {
    expect(ds.size).toBe(25 * 4 + 1 + 3);
    for (const k of ["customers/cus_0001/profile.json", "billers.json", "internal/fraud-rules.json", "internal/admin-credentials.txt", "internal/README.txt"]) {
      expect(ds.has(k)).toBe(true);
    }
  });

  it("names demo users", () => {
    expect(DEMO_USERS.map((u) => u.customerId)).toEqual(["cus_0001", "cus_0002", "cus_0003"]);
    expect(get<any>("customers/cus_0001/profile.json").name).toMatch(/^Alice/);
    expect(get<any>("customers/cus_0002/profile.json").name).toMatch(/^Bob/);
    expect(get<any>("customers/cus_0003/profile.json").name).toMatch(/^Carol/);
  });

  it("has valid fake cards", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    for (const id of ids) {
      const cards = get<any[]>(`customers/${id}/cards.json`);
      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) {
        expect(luhnValid(c.pan)).toBe(true);
        expect(/^(400000|555555)/.test(c.pan)).toBe(true);
      }
    }
  });

  it("has provably fake national ids", () => {
    for (const id of ids) expect(get<any>(`customers/${id}/profile.json`).nationalId).toMatch(/^9\d{2}-\d{2}-\d{4}$/);
  });

  it("has payments in the last 12 months", () => {
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() - 12);
    for (const id of ids) {
      const p = get<any[]>(`customers/${id}/payments.json`);
      expect(p.length).toBeGreaterThanOrEqual(45);
      expect(p.length).toBeLessThanOrEqual(55);
      for (const x of p) {
        const d = new Date(x.date);
        expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
        expect(d.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    }
    const elec = get<any[]>("customers/cus_0001/payments.json").filter((x) => x.billerName === "Electricity Co");
    expect(elec.length).toBe(12);
    expect(new Set(elec.map((x) => x.date.slice(0, 7))).size).toBe(12);
  });

  it("has empty schedules and fictional billers", () => {
    for (const id of ids) expect(get(`customers/${id}/scheduled-payments.json`)).toEqual([]);
    const b = get<any[]>("billers.json");
    expect(b.length).toBe(15);
    expect(b.filter((x) => x.name === "Electricity Co").length).toBe(1);
    for (const x of b) {
      const h = new URL(x.website).hostname;
      expect(h.endsWith(".example") || h.endsWith(".example.com")).toBe(true);
    }
  });
});
