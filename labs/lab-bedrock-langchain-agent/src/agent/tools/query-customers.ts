import { DynamicStructuredTool } from "@langchain/core/tools";
import { and, eq, ilike, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customers } from "../../db/schema.js";
import { escapeLike } from "./like.js";
import { limitField, readRows, type ToolDeps } from "./result.js";

const schema = z.object({
  id: z.number().int().positive().nullish().describe("Exact customer id."),
  name: z
    .string()
    .min(1)
    .max(100)
    .nullish()
    .describe("Full or partial customer name. Letter case is ignored."),
  email: z
    .string()
    .min(1)
    .max(200)
    .nullish()
    .describe("Exact email address. Letter case is ignored."),
  city: z
    .string()
    .min(1)
    .max(100)
    .nullish()
    .describe("Exact city name, for example Vienna. Letter case is ignored."),
  country: z
    .string()
    .min(1)
    .max(100)
    .nullish()
    .describe(
      "Exact country name, for example Austria. Letter case is ignored.",
    ),
  limit: limitField,
});

type Filters = z.infer<typeof schema>;

/** Turns the validated filters into one WHERE condition. */
function toCondition(filters: Filters): SQL | undefined {
  return and(
    filters.id != null ? eq(customers.id, filters.id) : undefined,
    filters.name != null
      ? ilike(customers.name, `%${escapeLike(filters.name)}%`)
      : undefined,
    filters.email != null
      ? ilike(customers.email, escapeLike(filters.email))
      : undefined,
    filters.city != null
      ? ilike(customers.city, escapeLike(filters.city))
      : undefined,
    filters.country != null
      ? ilike(customers.country, escapeLike(filters.country))
      : undefined,
  );
}

/**
 * The tool for the customers table. The model chooses filters; the query is
 * built here, so the model never writes SQL.
 */
export function createQueryCustomersTool({ db, logger }: ToolDeps) {
  return new DynamicStructuredTool({
    name: "query_customers",
    description:
      'Looks up customers of the shop. Use for: finding a customer\'s id, email, city or country, or counting customers that match a filter (read the "total" field). Do NOT use for: products, prices, stock, or what a customer ordered. All filters are optional and are combined with AND.',
    schema,
    func: async (filters) => {
      const condition = toCondition(filters);
      return readRows({
        db,
        logger,
        tool: "query_customers",
        limit: filters.limit,
        query: (tx, limit) =>
          tx
            .select({
              id: customers.id,
              name: customers.name,
              email: customers.email,
              city: customers.city,
              country: customers.country,
              created_at: customers.createdAt,
            })
            .from(customers)
            .where(condition)
            .orderBy(customers.id)
            .limit(limit),
        count: (tx) => tx.$count(customers, condition),
      });
    },
  });
}
