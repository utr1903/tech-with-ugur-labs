import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeInvalidArguments } from "./invalid-arguments.js";
import { positiveIntegerField } from "./tools/result.js";

describe("describeInvalidArguments", () => {
  it("names the field and what was expected for a type mismatch", () => {
    const message = describeInvalidArguments(
      z.object({ id: z.number().int() }),
      { id: "one" },
    );
    expect(message).toContain("id: ");
  });

  it("names the field for an enum violation", () => {
    const message = describeInvalidArguments(
      z.object({ status: z.enum(["pending", "shipped"]) }),
      { status: "lost" },
    );
    expect(message).toContain("status: ");
  });

  it("lists every offending field when more than one is wrong", () => {
    const message = describeInvalidArguments(
      z.object({
        id: z.number().int(),
        status: z.enum(["pending", "shipped"]),
      }),
      { id: "one", status: "lost" },
    );
    expect(message).toMatch(/^id: .+; status: .+$/);
  });

  it("names the field and says a whole number was expected when the value is the wrong kind entirely", () => {
    const message = describeInvalidArguments(
      z.object({ id: positiveIntegerField("Exact id.") }),
      { id: true },
    );
    expect(message).toContain("id");
    expect(message).toContain("whole number");
  });

  it("uses the field name 'arguments' for an issue without a path", () => {
    const message = describeInvalidArguments(
      z.object({ id: z.number() }),
      "not an object",
    );
    expect(message).toMatch(/^arguments: /);
  });

  it("caps the message at 500 characters", () => {
    const shape = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`field${index}`, z.number()]),
    );
    const message = describeInvalidArguments(z.object(shape), {});
    expect(message?.length).toBe(500);
  });

  it("returns null when the arguments fit the schema", () => {
    expect(
      describeInvalidArguments(z.object({ id: z.number() }), { id: 1 }),
    ).toBeNull();
  });

  it("returns null when there is no zod schema to check against", () => {
    expect(describeInvalidArguments(undefined, { id: "one" })).toBeNull();
    expect(describeInvalidArguments({ type: "object" }, {})).toBeNull();
  });
});
