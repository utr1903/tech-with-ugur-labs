import { DynamicStructuredTool } from "@langchain/core/tools";
import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ORDER_STATUSES, orders } from "../../db/schema.js";
import {
  limitField,
  positiveIntegerField,
  readRows,
  type ToolDeps,
} from "./result.js";

const schema = z.object({
  id: positiveIntegerField("Exact order id, a whole number such as 12."),
  customer_id: positiveIntegerField(
    "Id of the customer who placed the order, a whole number. Get it from query_customers.",
  ),
  product_id: positiveIntegerField(
    "Id of the ordered product, a whole number. Get it from query_products.",
  ),
  status: z
    .enum(ORDER_STATUSES)
    .nullish()
    .describe("Order status: pending, shipped, delivered or cancelled."),
  limit: limitField,
});

type Filters = z.infer<typeof schema>;

/** Turns the validated filters into one WHERE condition. */
function toCondition(filters: Filters): SQL | undefined {
  return and(
    filters.id != null ? eq(orders.id, filters.id) : undefined,
    filters.customer_id != null
      ? eq(orders.customerId, filters.customer_id)
      : undefined,
    filters.product_id != null
      ? eq(orders.productId, filters.product_id)
      : undefined,
    filters.status != null ? eq(orders.status, filters.status) : undefined,
  );
}

/**
 * The tool for the orders table. It returns ids only, on purpose: to name
 * the customer or the product the agent has to use the other two tools.
 */
export function createQueryOrdersTool({ db, logger }: ToolDeps) {
  return new DynamicStructuredTool({
    name: "query_orders",
    description:
      "Looks up orders of the shop. Use for: finding what a customer ordered, how many units, the order status, or which orders contain a product. Rows contain customer_id and product_id, not names. Do NOT use for: looking up names, emails or prices; use query_customers and query_products with the ids. All filters are optional and are combined with AND.",
    schema,
    func: async (filters) => {
      const condition = toCondition(filters);
      return readRows({
        db,
        logger,
        tool: "query_orders",
        limit: filters.limit,
        query: (tx, limit) =>
          tx
            .select({
              id: orders.id,
              customer_id: orders.customerId,
              product_id: orders.productId,
              quantity: orders.quantity,
              status: orders.status,
              ordered_at: orders.orderedAt,
            })
            .from(orders)
            .where(condition)
            .orderBy(orders.id)
            .limit(limit),
        count: (tx) => tx.$count(orders, condition),
      });
    },
  });
}
