import { integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** The states an order can be in. */
export const ORDER_STATUSES = [
  "pending",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export const orderStatus = pgEnum("order_status", ORDER_STATUSES);

/** People who buy from the shop. */
export const customers = pgTable("customers", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  email: text("email").notNull().unique(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Things the shop sells. Prices are whole cents to avoid rounding errors. */
export const products = pgTable("products", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  priceCents: integer("price_cents").notNull(),
  stock: integer("stock").notNull(),
});

/** One product bought by one customer. Both references are enforced. */
export const orders = pgTable("orders", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull(),
  status: orderStatus("status").notNull(),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
});

export type NewCustomer = typeof customers.$inferInsert;
export type NewProduct = typeof products.$inferInsert;
export type NewOrder = typeof orders.$inferInsert;
