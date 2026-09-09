import { beforeEach, describe, expect, it } from "vitest";
import { FleetStore } from "./store.js";

const user = { id: "u-rosa", name: "Rosa Iglesias" };

function newReport() {
  return {
    siteId: "almeria-roof",
    component: "Inverter" as const,
    componentRef: "String 3 inverter",
    workDate: "2026-09-09",
    durationHours: 2,
    summary: "Replaced the string 3 inverter fan.",
    followUpRequired: true,
    followUpNote: "Panel 14 still shows a hotspot.",
  };
}

describe("FleetStore", () => {
  let store: FleetStore;
  beforeEach(() => {
    store = new FleetStore();
  });

  it("seeds four sites", () => {
    expect(store.listSites()).toHaveLength(4);
    expect(store.getSite("almeria-roof")?.name).toBe("Almeria Roof Array");
  });

  it("starts with no reports", () => {
    expect(store.listReports()).toEqual([]);
  });

  it("stamps a stored report with its engineer and an id", () => {
    const stored = store.addReport(newReport(), user);
    expect(stored.id).toMatch(/^r-/);
    expect(stored.engineerId).toBe("u-rosa");
    expect(stored.engineerName).toBe("Rosa Iglesias");
    expect(store.listReports()).toHaveLength(1);
  });

  it("rejects a report for an unknown site", () => {
    expect(() =>
      store.addReport({ ...newReport(), siteId: "nope" }, user),
    ).toThrow(/Unknown site/);
  });

  it("returns newest reports first", () => {
    store.addReport({ ...newReport(), summary: "first" }, user);
    store.addReport({ ...newReport(), summary: "second" }, user);
    expect(store.listReports()[0]?.summary).toBe("second");
  });
});
