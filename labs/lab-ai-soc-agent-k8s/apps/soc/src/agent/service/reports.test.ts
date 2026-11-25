import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReportStore, newReportId } from "./reports.js";
import { report } from "./test-support.js";

const tmp = () => mkdtemp(join(tmpdir(), "soc-reports-"));

describe("newReportId", () => {
  it("formats prefix, UTC timestamp and 4 hex chars", () => {
    const id = newReportId("investigate", new Date("2026-11-25T12:03:04.567Z"));
    expect(id).toMatch(/^inv-20261125T120304-[0-9a-f]{4}$/);
    expect(newReportId("hunt", new Date())).toMatch(/^hunt-\d{8}T\d{6}-/);
  });
});

describe("createReportStore", () => {
  it("round-trips a report and writes json plus markdown, no temp files", async () => {
    const dir = await tmp();
    const store = createReportStore(dir);
    const r = report("inv-20261125T120000-aaaa");
    await store.save(r);
    expect(await store.get(r.id)).toEqual(r);
    expect((await readdir(dir)).sort()).toEqual([`${r.id}.json`, `${r.id}.md`]);
  });

  it("returns undefined for unknown or malformed ids", async () => {
    const store = createReportStore(await tmp());
    expect(await store.get("inv-20261125T120000-ffff")).toBeUndefined();
    expect(await store.get("../etc/passwd")).toBeUndefined();
  });

  it("lists newest first", async () => {
    const store = createReportStore(await tmp());
    await store.save(
      report("inv-20261125T120000-aaaa", {
        createdAt: "2026-11-25T12:00:00.000Z",
      }),
    );
    await store.save(
      report("hunt-20261125T130000-bbbb", {
        mode: "hunt",
        createdAt: "2026-11-25T13:00:00.000Z",
      }),
    );
    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual([
      "hunt-20261125T130000-bbbb",
      "inv-20261125T120000-aaaa",
    ]);
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(
      ["createdAt", "finishedAt", "id", "mode"].sort(),
    );
  });

  it("lists an empty or missing directory as empty", async () => {
    const store = createReportStore(join(await tmp(), "nope"));
    expect(await store.list()).toEqual([]);
  });
});
