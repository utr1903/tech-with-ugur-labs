import { expect, it } from "vitest";
import { priorObservation } from "./prior-results.js";

it("requires exact operator-retained marker and successful creation for a cross-Job denial", () => {
  const actual = {
    status: 200,
    body: { exitCode: 1, output: "No such file\n" },
  };
  expect(
    priorObservation(
      "secure",
      actual,
      "MARKER\n",
      { exists: true, output: "MARKER\n" },
      true,
    ),
  ).toBe(true);
  expect(
    priorObservation(
      "secure",
      actual,
      "MARKER\n",
      { exists: false, output: "" },
      true,
    ),
  ).toBe(false);
  expect(
    priorObservation(
      "secure",
      actual,
      "MARKER\n",
      { exists: true, output: "MARKER\n" },
      false,
    ),
  ).toBe(false);
  expect(
    priorObservation(
      "secure",
      { status: 200, body: { exitCode: 0, output: "MARKER\n" } },
      "MARKER\n",
      { exists: true, output: "MARKER\n" },
      true,
    ),
  ).toBe(false);
});
