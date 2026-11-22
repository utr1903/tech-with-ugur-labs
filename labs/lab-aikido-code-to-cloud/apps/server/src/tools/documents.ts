import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import type { ToolContext } from "./index";

export function makeDocumentsTool(ctx: ToolContext) {
  return tool(
    async (input: { path: string }) => {
      try {
        // INSECURE-BY-DESIGN: user path concatenated onto the customer prefix, no containment check (path traversal)
        const key = path.posix.join(`customers/${ctx.customerId}/` + input.path);
        return await ctx.store.getText(key);
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "get_document",
      description: "Fetch a document for the customer. Documents are addressed by a relative path inside the customer's folder, e.g. statements/2026-03.txt or invoices/inv-001.txt. Pass the path exactly as the customer gives it.",
      schema: z.object({ path: z.string().describe("Document path relative to the customer's folder") }),
    },
  );
}
