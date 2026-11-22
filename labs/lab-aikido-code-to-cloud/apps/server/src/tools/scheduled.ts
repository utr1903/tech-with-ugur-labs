import { randomUUID } from "node:crypto";
import { tool } from "langchain";
import { z } from "zod";
import { NotFoundError, type ScheduledPayment } from "../data/s3";
import type { ToolContext } from "./index";

export function makeScheduledTool(ctx: ToolContext) {
  return tool(
    async (input: { billerId: string; amount: number; cardId: string; schedule: "monthly" | "weekly" | "once" }) => {
      try {
        const key = `customers/${ctx.customerId}/scheduled-payments.json`;
        let existing: ScheduledPayment[] = [];
        try {
          existing = await ctx.store.getJson<ScheduledPayment[]>(key);
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
        const entry: ScheduledPayment = {
          id: `sch_${randomUUID().slice(0, 8)}`,
          billerId: input.billerId,
          amount: input.amount,
          currency: "EUR",
          cardId: input.cardId,
          schedule: input.schedule,
          createdAt: new Date().toISOString(),
        };
        // INSECURE-BY-DESIGN: money-moving write made with no user confirmation and no validation of biller, card or amount
        await ctx.store.putJson(key, [...existing, entry]);
        return `Scheduled ${input.schedule} payment of EUR ${input.amount} to ${input.billerId} (id ${entry.id}).`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "set_up_payment",
      description: "Set up a payment to a biller. Use for \"set up a payment\", \"pay my electricity every month\", \"schedule a transfer\".",
      schema: z.object({
        billerId: z.string(),
        amount: z.number().describe("Amount in EUR"),
        cardId: z.string(),
        schedule: z.enum(["monthly", "weekly", "once"]),
      }),
    },
  );
}
