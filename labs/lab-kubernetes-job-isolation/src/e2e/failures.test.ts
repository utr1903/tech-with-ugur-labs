import { expect, it } from "vitest";
import { capped } from "./failures.js";

it("requires actual 64KiB capture, explicit truncation, metadata cap and terminated worker", () => {
  const evidence = {
    status: 200,
    output: "y".repeat(65536),
    truncated: true,
    outputSize: 65536,
    metadataSize: 36,
    workerTerminated: true,
  };
  expect(capped(evidence)).toBe(true);
  expect(capped({ ...evidence, outputSize: 65537 })).toBe(false);
  expect(capped({ ...evidence, truncated: false })).toBe(false);
  expect(capped({ ...evidence, workerTerminated: false })).toBe(false);
});
