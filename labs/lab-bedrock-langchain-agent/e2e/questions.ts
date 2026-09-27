import type { Question } from "./build-questions.js";

/**
 * The five e2e questions with their expected answers, derived from the seed
 * in src/db/seed-data.ts. If you change the seed, run the unit tests: the
 * failing test prints the values to put here.
 */
export const QUESTIONS: Question[] = [
  {
    id: "customer-lookup",
    question: "What is the email address of the customer Marcella Cormier?",
    expected: ["marcella.cormier@example.com"],
  },
  {
    id: "customer-filter",
    question:
      "How many customers live in Munich? Answer with the number as digits.",
    expected: ["7"],
  },
  {
    id: "product-lookup",
    question: 'What is the price of the product "Fresh Bamboo Pizza"?',
    expected: ["43.82"],
  },
  {
    id: "product-filter",
    question: "Which product in the Kitchen category has the lowest stock?",
    expected: ["Handmade Rubber Keyboard"],
  },
  {
    id: "orders-across-tables",
    question:
      "Which product did the customer Brionna Ebert order, and how many units? Answer with the product name and the quantity as digits.",
    expected: ["Bespoke Gold Car", "3"],
  },
];
