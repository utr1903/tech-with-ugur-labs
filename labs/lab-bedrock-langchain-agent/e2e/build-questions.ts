import type { SeedData } from "../src/db/seed-data.js";

/** One e2e question with the values its answer must contain. */
export type Question = { id: string; question: string; expected: string[] };

/** Returns the item or fails loudly; the seed guarantees these exist. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Seed data has no ${what}`);
  }
  return value;
}

/**
 * Derives the five questions and their answers from the seed data. The
 * result is committed in questions.ts; a test keeps both in sync, so the
 * expected answers can be read without running anything.
 */
export function buildQuestions(data: SeedData): Question[] {
  const lookupCustomer = must(data.customers[0], "first customer");
  const city = must(data.customers[1], "second customer").city;
  const cityCount = data.customers.filter((c) => c.city === city).length;
  const product = must(data.products[0], "first product");
  const category = must(data.products[1], "second product").category;
  const lowest = must(
    data.products
      .filter((p) => p.category === category)
      .sort((a, b) => a.stock - b.stock)[0],
    "product in category",
  );
  const lastCustomer = must(data.customers.at(-1), "last customer");
  const order = must(
    data.orders.find((o) => o.customerId === lastCustomer.id),
    "order of the last customer",
  );
  const ordered = must(
    data.products.find((p) => p.id === order.productId),
    "ordered product",
  );

  return [
    {
      id: "customer-lookup",
      question: `What is the email address of the customer ${lookupCustomer.name}?`,
      expected: [lookupCustomer.email],
    },
    {
      id: "customer-filter",
      question: `How many customers live in ${city}? Answer with the number as digits.`,
      expected: [String(cityCount)],
    },
    {
      id: "product-lookup",
      question: `What is the price of the product "${product.name}"?`,
      expected: [(product.priceCents / 100).toFixed(2)],
    },
    {
      id: "product-filter",
      question: `Which product in the ${category} category has the lowest stock?`,
      expected: [lowest.name],
    },
    {
      id: "orders-across-tables",
      question: `Which product did the customer ${lastCustomer.name} order, and how many units? Answer with the product name and the quantity as digits.`,
      expected: [ordered.name, String(order.quantity)],
    },
  ];
}
