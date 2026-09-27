import {
  DynamicStructuredTool,
  ToolInputParsingException,
} from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  describeInvalidArguments,
  INVALID_ARGUMENTS_GENERIC,
} from "./invalid-arguments.js";

/**
 * Every real tool schema is created with `verboseParsingErrors: true`, so
 * this rebuilds the same shape of exception a rejected call actually
 * throws, instead of constructing one by hand.
 */
async function invalidArgumentsFor(
  schema: z.ZodObject<z.ZodRawShape>,
  args: Record<string, unknown>,
): Promise<ToolInputParsingException> {
  const tool = new DynamicStructuredTool({
    name: "probe",
    description: "probe",
    schema,
    verboseParsingErrors: true,
    func: async () => "ok",
  });
  try {
    await tool.invoke(args as never);
  } catch (err) {
    if (err instanceof ToolInputParsingException) return err;
    throw err;
  }
  throw new Error("expected the tool call to be rejected");
}

describe("describeInvalidArguments", () => {
  it("names the field and what was expected for a type mismatch", async () => {
    const err = await invalidArgumentsFor(z.object({ id: z.number().int() }), {
      id: "one",
    });
    const message = describeInvalidArguments(err);
    expect(message).toContain("id");
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it("names the field for an enum violation", async () => {
    const err = await invalidArgumentsFor(
      z.object({ status: z.enum(["pending", "shipped"]) }),
      { status: "lost" },
    );
    expect(describeInvalidArguments(err)).toContain("status");
  });

  it("lists every offending field when more than one is wrong", async () => {
    const err = await invalidArgumentsFor(
      z.object({
        id: z.number().int(),
        status: z.enum(["pending", "shipped"]),
      }),
      { id: "one", status: "lost" },
    );
    const message = describeInvalidArguments(err);
    expect(message).toContain("id");
    expect(message).toContain("status");
  });

  it("falls back to the generic message instead of leaking a filesystem path", () => {
    const err = new ToolInputParsingException(
      'Received tool input did not match expected schema\nDetails: [{"path":["id"],"message":"secret /home/node/.aws path"}]\n\n✖ secret /home/node/.aws path\n  → at id',
      "{}",
    );
    expect(describeInvalidArguments(err)).toBe(INVALID_ARGUMENTS_GENERIC);
  });

  it("falls back to the generic message when no issue block can be found", () => {
    const err = new ToolInputParsingException(
      "Received tool input did not match expected schema",
      "{}",
    );
    expect(describeInvalidArguments(err)).toBe(INVALID_ARGUMENTS_GENERIC);
  });
});
