export type Order = {
  id: number;
  item: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

// Deterministic pseudo-data: same input, same rows, no randomness.
// Prices deliberately land off full euros (199..1098 cents) so a
// truncating integer division cents -> euros visibly corrupts them.
export function generateOrders(count: number): Order[] {
  const orders: Order[] = [];
  for (let i = 1; i <= count; i++) {
    const quantity = (i % 5) + 1;
    const unitPriceCents = 199 + ((i * 37) % 900);
    orders.push({
      id: i,
      item: `item-${(i % 7) + 1}`,
      quantity,
      unitPriceCents,
      totalCents: quantity * unitPriceCents,
    });
  }
  return orders;
}

export function grandTotalCents(orders: Order[]): number {
  return orders.reduce((sum, order) => sum + order.totalCents, 0);
}
