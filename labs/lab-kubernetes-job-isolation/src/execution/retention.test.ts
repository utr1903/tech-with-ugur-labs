import { expect, it } from "vitest";
import { CompletedExecutions } from "./retention.js";

it("preserves the first 128 completed fixtures and evicts oldest before another admission", async () => {
  const retention = new CompletedExecutions();
  const deleted: string[] = [];
  for (let index = 0; index < 128; index++) {
    await retention.prune(async (id) => {
      deleted.push(id);
    }, 1000);
    retention.add(`id-${index}`, 1000);
  }
  expect(deleted).toEqual([]);
  await retention.prune(async (id) => {
    deleted.push(id);
  }, 1000);
  expect(deleted).toEqual(["id-0"]);
});
it("expires one-hour-old fixtures and retains an entry if its cleanup fails", async () => {
  const retention = new CompletedExecutions();
  retention.add("old", 0);
  retention.add("recent", 3600000);
  await expect(
    retention.prune(async () => {
      throw new Error("delete failed");
    }, 3600000),
  ).rejects.toThrow("delete failed");
  const deleted: string[] = [];
  await retention.prune(async (id) => {
    deleted.push(id);
  }, 3600000);
  expect(deleted).toEqual(["old"]);
});
it("evicts only the overflow after two simultaneous completions", async () => {
  const retention = new CompletedExecutions();
  for (let index = 0; index < 129; index++) retention.add(`id-${index}`, 1000);
  const removed: string[] = [];
  await retention.prune(
    async (id) => {
      removed.push(id);
    },
    1000,
    0,
  );
  expect(removed).toEqual(["id-0"]);
});
