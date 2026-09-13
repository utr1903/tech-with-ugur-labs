import { expect, it } from "vitest";
import { runtimeRestricted } from "./controls.js";

it("requires actual nonroot, capabilities, nnp and EROFS rather than ordinary EACCES", () => {
  const output =
    "uid=10001\nCapInh:\t0000\nCapPrm:\t0000\nCapEff:\t0000\nCapBnd:\t0000\nCapAmb:\t0000\nNoNewPrivs:\t1\nhome-owner=10001:10001\ntouch: Read-only file system\n";
  expect(runtimeRestricted(output)).toBe(true);
  expect(
    runtimeRestricted(
      output.replace("Read-only file system", "Permission denied"),
    ),
  ).toBe(false);
  expect(runtimeRestricted(output.replace("uid=10001", "uid=0"))).toBe(false);
});
