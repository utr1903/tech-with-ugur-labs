import { en, Faker } from "@faker-js/faker";
import {
  type NewCustomer,
  type NewOrder,
  type NewProduct,
  ORDER_STATUSES,
} from "./schema.js";

/** Change this to get a different dataset; the e2e answers then change too. */
export const SEED = 20260927;

/** Fixes "now" for the generator so dates never depend on the run date. */
const REFERENCE_DATE = new Date("2026-09-01T00:00:00.000Z");
const YEAR_START = new Date("2026-01-01T00:00:00.000Z");

/** The five cities customers live in, each with its one country. */
export const CITIES = [
  { city: "Munich", country: "Germany" },
  { city: "Vienna", country: "Austria" },
  { city: "Lyon", country: "France" },
  { city: "Porto", country: "Portugal" },
  { city: "Ghent", country: "Belgium" },
] as const;

/** The four product categories, assigned to products in turn. */
export const CATEGORIES = ["Audio", "Kitchen", "Outdoor", "Office"] as const;

const CUSTOMER_COUNT = 20;
const PRODUCT_COUNT = 15;
const ORDER_COUNT = 60;

export type SeedData = {
  customers: (NewCustomer & { id: number })[];
  products: (NewProduct & { id: number })[];
  orders: (NewOrder & { id: number })[];
};

/** Calls `make` until it returns a value not seen before. */
function unique(seen: Set<string>, make: () => string): string {
  let value = make();
  while (seen.has(value)) {
    value = make();
  }
  seen.add(value);
  return value;
}

function makeCustomers(faker: Faker): SeedData["customers"] {
  const names = new Set<string>();
  return Array.from({ length: CUSTOMER_COUNT }, (_, index) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const name = unique(names, () =>
      names.has(`${firstName} ${lastName}`)
        ? `${faker.person.firstName()} ${lastName}`
        : `${firstName} ${lastName}`,
    );
    const place = faker.helpers.arrayElement(CITIES);
    return {
      id: index + 1,
      name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
      city: place.city,
      country: place.country,
      createdAt: faker.date.between({ from: YEAR_START, to: REFERENCE_DATE }),
    };
  });
}

function makeProducts(faker: Faker): SeedData["products"] {
  const names = new Set<string>();
  // Globally unique stock values make the lowest stock in a category unique.
  const stocks = faker.helpers.uniqueArray(
    () => faker.number.int({ min: 1, max: 200 }),
    PRODUCT_COUNT,
  );
  return Array.from({ length: PRODUCT_COUNT }, (_, index) => ({
    id: index + 1,
    name: unique(names, () => faker.commerce.productName()),
    // Round-robin so every category has at least three products.
    category: CATEGORIES[index % CATEGORIES.length] as string,
    priceCents: faker.number.int({ min: 499, max: 49999 }),
    stock: stocks[index] as number,
  }));
}

function makeOrders(faker: Faker): SeedData["orders"] {
  return Array.from({ length: ORDER_COUNT }, (_, index) => ({
    id: index + 1,
    // The last customer gets exactly one order (the last one), which gives
    // the e2e a question with a single unambiguous answer.
    customerId:
      index === ORDER_COUNT - 1
        ? CUSTOMER_COUNT
        : faker.number.int({ min: 1, max: CUSTOMER_COUNT - 1 }),
    productId: faker.number.int({ min: 1, max: PRODUCT_COUNT }),
    quantity: faker.number.int({ min: 1, max: 5 }),
    status: faker.helpers.arrayElement(ORDER_STATUSES),
    orderedAt: faker.date.between({ from: YEAR_START, to: REFERENCE_DATE }),
  }));
}

/**
 * Generates the whole dataset from a fixed seed. The data looks random but is
 * identical on every machine, which is what makes known-answer checks possible.
 */
export function generateSeedData(seed: number = SEED): SeedData {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  faker.setDefaultRefDate(REFERENCE_DATE);
  return {
    customers: makeCustomers(faker),
    products: makeProducts(faker),
    orders: makeOrders(faker),
  };
}
