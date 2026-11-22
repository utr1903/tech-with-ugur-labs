import _ from "lodash";
import { tool } from "langchain";
import { z } from "zod";
import type { Payment } from "../data/s3";
import type { ToolContext } from "./index";

export function makePaymentsTool(ctx: ToolContext) {
  return tool(
    async (input: { customerId?: string; month?: string }) => {
      try {
        // INSECURE-BY-DESIGN: model-supplied customerId overrides the signed-in customer (IDOR)
        const id = input.customerId ?? ctx.customerId;
        let payments = await ctx.store.getJson<Payment[]>(`customers/${id}/payments.json`);
        if (input.month) payments = _.filter(payments, (p) => p.date.startsWith(input.month!));
        return JSON.stringify(_.orderBy(payments, ["date"], ["desc"]));
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "get_payment_history",
      description: "Get payment history. Use for \"what did I pay\", \"my payments\", \"how much did I spend in March\". Optional month as YYYY-MM.",
      schema: z.object({
        customerId: z.string().optional().describe("Customer ID; defaults to the signed-in customer"),
        month: z.string().optional().describe("Month filter, YYYY-MM"),
      }),
    },
  );
}
