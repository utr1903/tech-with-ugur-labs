import { DynamicStructuredTool } from "@langchain/core/tools";
import { and, eq, ilike, type SQL } from "drizzle-orm";
import { z } from "zod";
import { products } from "../../db/schema.js";
import { escapeLike } from "./like.js";
import {
  limitField,
  positiveIntegerField,
  readRows,
  type ToolDeps,
} from "./result.js";

const schema = z.object({
  id: positiveIntegerField("Exact product id, a whole number such as 12."),
  name: z
    .string()
    .min(1)
    .max(100)
    .nullish()
    .describe("Full or partial product name. Letter case is ignored."),
  category: z
    .string()
    .min(1)
    .max(100)
    .nullish()
    .describe(
      "Exact category: Audio, Kitchen, Outdoor or Office. Letter case is ignored.",
    ),
  limit: limitField,
});

type Filters = z.infer<typeof schema>;

/** Turns the validated filters into one WHERE condition. */
function toCondition(filters: Filters): SQL | undefined {
  return and(
    filters.id != null ? eq(products.id, filters.id) : undefined,
    filters.name != null
      ? ilike(products.name, `%${escapeLike(filters.name)}%`)
      : undefined,
    filters.category != null
      ? ilike(products.category, escapeLike(filters.category))
      : undefined,
  );
}

/**
 * The tool for the products table. It returns the price twice: as stored
 * (cents) and formatted, so no model has to do the division itself.
 */
export function createQueryProductsTool({ db, logger }: ToolDeps) {
  return new DynamicStructuredTool({
    name: "query_products",
    description:
      'Looks up products of the shop. Use for: finding a product\'s id, name, category, price or stock, or listing the products of a category. "price" is in US dollars, "price_cents" is the same amount in cents. Do NOT use for: customers, or who ordered a product. All filters are optional and are combined with AND.',
    schema,
    func: async (filters) => {
      const condition = toCondition(filters);
      return readRows({
        db,
        logger,
        tool: "query_products",
        limit: filters.limit,
        query: async (tx, limit) => {
          const rows = await tx
            .select()
            .from(products)
            .where(condition)
            .orderBy(products.id)
            .limit(limit);
          return rows.map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            price_cents: row.priceCents,
            price: (row.priceCents / 100).toFixed(2),
            stock: row.stock,
          }));
        },
        count: (tx) => tx.$count(products, condition),
      });
    },
  });
}
