export interface Product {
  id: number;
  name: string;
  priceEur: number;
}

export const PRODUCTS: readonly Product[] = [
  { id: 1, name: "Ceramic mug", priceEur: 12 },
  { id: 2, name: "Linen tote bag", priceEur: 18 },
  { id: 3, name: "Desk plant", priceEur: 25 },
];
