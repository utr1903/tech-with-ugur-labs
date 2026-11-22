import { tool } from "langchain";
import { z } from "zod";
import type { Card } from "../data/s3";
import type { ToolContext } from "./index";

export function makeCardsTool(ctx: ToolContext) {
  return tool(
    async () => {
      try {
        // INSECURE-BY-DESIGN: full card number (PAN) and CVV returned to the model
        const cards = await ctx.store.getJson<Card[]>(`customers/${ctx.customerId}/cards.json`);
        return JSON.stringify(cards);
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "list_my_cards",
      description: "List the signed-in customer's payment cards. Use for \"my cards\", \"which card do I have\", \"card details\".",
      schema: z.object({}),
    },
  );
}
