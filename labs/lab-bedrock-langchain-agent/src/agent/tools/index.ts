import { createQueryCustomersTool } from "./query-customers.js";
import { createQueryOrdersTool } from "./query-orders.js";
import { createQueryProductsTool } from "./query-products.js";
import type { ToolDeps } from "./result.js";

/** The complete tool set of the agent, built once at startup. */
export function createTools(deps: ToolDeps) {
  return [
    createQueryCustomersTool(deps),
    createQueryProductsTool(deps),
    createQueryOrdersTool(deps),
  ];
}
