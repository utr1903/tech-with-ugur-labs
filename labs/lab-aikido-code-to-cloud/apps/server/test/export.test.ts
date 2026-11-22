import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDataset } from "../scripts/export";
import { generateDataset } from "../scripts/generate";

const now = new Date("2026-11-20");

describe("writeDataset", () => {
  it("writes nested json and text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-test-"));
    try {
      const data = new Map<string, unknown>([
        ["customers/cus_0001/profile.json", { id: "cus_0001", name: "Alice Doe" }],
        ["internal/README.txt", "hello\n  world"],
      ]);
      const count = await writeDataset(dir, data);
      expect(count).toBe(2);

      const profile = JSON.parse(await readFile(join(dir, "customers/cus_0001/profile.json"), "utf8"));
      expect(profile).toEqual({ id: "cus_0001", name: "Alice Doe" });
      expect(await readFile(join(dir, "internal/README.txt"), "utf8")).toBe("hello\n  world");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes the full generated dataset with a matching file count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-test-"));
    try {
      const data = generateDataset({ customers: 3, seed: 42, now });
      const count = await writeDataset(dir, data);
      expect(count).toBe(data.size);
      const profile = JSON.parse(await readFile(join(dir, "customers/cus_0001/profile.json"), "utf8"));
      expect(profile).toEqual(data.get("customers/cus_0001/profile.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("different seeds give different data", async () => {
    const a = await mkdtemp(join(tmpdir(), "export-test-"));
    const b = await mkdtemp(join(tmpdir(), "export-test-"));
    try {
      await writeDataset(a, generateDataset({ customers: 3, seed: 42, now }));
      await writeDataset(b, generateDataset({ customers: 3, seed: 43, now }));
      const pa = await readFile(join(a, "customers/cus_0001/profile.json"), "utf8");
      const pb = await readFile(join(b, "customers/cus_0001/profile.json"), "utf8");
      expect(pa).not.toEqual(pb);
    } finally {
      await rm(a, { recursive: true, force: true });
      await rm(b, { recursive: true, force: true });
    }
  });
});
