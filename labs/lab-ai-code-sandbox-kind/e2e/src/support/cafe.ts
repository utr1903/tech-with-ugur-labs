// The same word problem the scripted model is built around (server/src/agent/cafe-script.ts).
export const CAFE_PROBLEM =
  "A café sells coffee, tea and sandwiches. Anna pays €13 for 2 coffees, 1 tea and 1 sandwich. Ben pays €19 for 1 coffee, 3 teas and 2 sandwiches. Cleo pays €18 for 3 coffees, 2 teas and 1 sandwich. What does each item cost?";

export const EXPECTED_PRICES = { coffee: 3, tea: 2, sandwich: 5 } as const;

export const SECTION_HEADINGS = [
  "Model",
  "Solver",
  "Solution",
  "Verification",
] as const;
