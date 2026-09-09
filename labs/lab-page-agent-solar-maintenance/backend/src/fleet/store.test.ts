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

  it("hands out copies, so a caller cannot reach back into the store", () => {
    const site = store.listSites()[0];
    site?.arrays.push("String 99");
    if (site) site.name = "Renamed";
    expect(store.listSites()[0]?.arrays).not.toContain("String 99");
    expect(store.listSites()[0]?.name).toBe("Almeria Roof Array");

    store.addReport(newReport(), user);
    const report = store.listReports()[0];
    if (report) report.summary = "tampered";
    expect(store.listReports()[0]?.summary).toBe(
      "Replaced the string 3 inverter fan.",
    );
  });

  it("does not let one store corrupt the next one", () => {
    // The seed is module-level: a shallow copy would share its `arrays`.
    store.listSites()[0]?.arrays.push("String 99");
    expect(new FleetStore().listSites()[0]?.arrays).not.toContain("String 99");
  });
});
