import { expect, it } from "vitest";
import { cleanupPaths, cleanupProven } from "./timeout.js";

it("includes insecure root captured output and metadata as well as the generated run directory", () => {
  expect(cleanupPaths("insecure", "id")).toEqual([
    "/data/runs/id",
    "/data/id.md",
    "/data/id.exit",
  ]);
  expect(cleanupPaths("secure", "id")).toEqual([
    "/data/runs/id",
    "/data/runs/id/id.md",
    "/data/runs/id/id.exit",
  ]);
});
it("does not credit missing Job as cleanup when an independently observed Pod survives", () => {
  const paths = cleanupPaths("insecure", "id");
  expect(
    cleanupProven(
      true,
      ["orphan-pod"],
      paths,
      paths.map((path) => ({ path, exists: false })),
    ),
  ).toBe(false);
});
it("rejects leftover captured output or metadata even when the run directory is gone", () => {
  const paths = ["/data/runs/id", "/data/id.md", "/data/id.exit"];
  for (const index of [1, 2])
    expect(
      cleanupProven(
        true,
        [],
        paths,
        paths.map((path, offset) => ({ path, exists: offset === index })),
      ),
    ).toBe(false);
  expect(
    cleanupProven(true, [], paths, [{ path: paths[0] ?? "", exists: false }]),
  ).toBe(false);
});
it("requires actual named absent paths and actual Job absence", () => {
  const paths = ["/data/runs/id", "/data/id.md", "/data/id.exit"];
  const observed = paths.map((path) => ({ path, exists: false }));
  expect(cleanupProven(true, [], paths, observed)).toBe(true);
  expect(cleanupProven(false, [], paths, observed)).toBe(false);
});
