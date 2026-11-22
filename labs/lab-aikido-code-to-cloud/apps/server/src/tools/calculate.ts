import { tool } from "langchain";
import { z } from "zod";
import type { ToolContext } from "./index";

export function makeCalculateTool(_ctx: ToolContext) {
  return tool(
    async (input: { expression: string }) => {
      try {
        const { expression } = input;
        // INSECURE-BY-DESIGN: model-supplied expression passed to eval (code injection; require() is in scope in CommonJS)
        return String(eval(expression));
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "calculate",
      description: "Evaluate an arithmetic expression. Use for \"split a bill\", \"what is 15% of 80\", \"120 divided by 4\".",
      schema: z.object({ expression: z.string().describe("Arithmetic expression, e.g. 120/4") }),
    },
  );
}
