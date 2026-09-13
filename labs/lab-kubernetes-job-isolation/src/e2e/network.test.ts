import { expect, it } from "vitest";
import { dnsObservation } from "./network.js";

it("requires completed bounded DNS failure and the exact resolved ServiceIP positive control", () => {
  expect(
    dnsObservation(
      "insecure",
      { status: 200, body: { exitCode: 0, output: "10.1.2.3 fixture\n" } },
      "10.1.2.3",
    ),
  ).toBe(true);
  expect(
    dnsObservation(
      "insecure",
      { status: 200, body: { exitCode: 0, output: "" } },
      "10.1.2.3",
    ),
  ).toBe(false);
  expect(dnsObservation("secure", { status: 504, body: {} }, "10.1.2.3")).toBe(
    false,
  );
  expect(
    dnsObservation(
      "secure",
      { status: 200, body: { exitCode: 124, output: "dns-exit=124\n" } },
      "10.1.2.3",
    ),
  ).toBe(true);
});
