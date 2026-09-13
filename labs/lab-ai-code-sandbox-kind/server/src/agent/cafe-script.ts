// The fixed demo the scripted (keyless) model plays: one café word problem,
// the Python it sends to the sandbox, and an answer template filled ONLY
// from the tool result it received.

export const CAFE_PROBLEM =
  "A café sells coffee, tea and sandwiches. Anna pays €13 for 2 coffees, 1 tea and 1 sandwich. Ben pays €19 for 1 coffee, 3 teas and 2 sandwiches. Cleo pays €18 for 3 coffees, 2 teas and 1 sandwich. What does each item cost?";

export const CAFE_SOLVER_CODE = [
  "import json",
  "import numpy as np",
  "",
  "# Rows: Anna, Ben, Cleo. Columns: coffee, tea, sandwich.",
  "A = np.array([[2, 1, 1], [1, 3, 2], [3, 2, 1]], dtype=float)",
  "b = np.array([13, 19, 18], dtype=float)",
  "x = np.linalg.solve(A, b)",
  "max_residual = float(np.max(np.abs(A @ x - b)))",
  'solution = {name: round(float(v), 6) for name, v in zip(["coffee", "tea", "sandwich"], x)}',
  'print("solution:", solution)',
  'print("max residual:", max_residual)',
  'with open("result.json", "w") as f:',
  '    json.dump({"solution": solution, "maxResidual": max_residual}, f)',
].join("\n");

interface ToolRun {
  status?: string;
  error?: string;
  result?: { solution?: Record<string, number>; maxResidual?: number } | null;
}

function parseToolRun(toolContent: string): ToolRun | undefined {
  try {
    const parsed: unknown = JSON.parse(toolContent);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as ToolRun)
      : undefined;
  } catch {
    return undefined;
  }
}

export function renderCafeAnswer(toolContent: string): string {
  const run = parseToolRun(toolContent);
  if (!run) {
    return "The sandbox returned an unreadable result, so I cannot give verified prices.";
  }
  const solution = run.result?.solution;
  if (run.status !== "succeeded" || !solution) {
    const reason = run.error ?? run.status ?? "unknown";
    return `The sandbox run did not produce a solution (${reason}), so I cannot give verified prices.`;
  }
  const rows = Object.entries(solution).map(
    ([item, price]) => `| ${item} | ${Number(price.toFixed(2))} |`,
  );
  return [
    "### Model",
    "",
    "Let c, t and s be the prices in euros of a coffee, a tea and a sandwich:",
    "",
    "- Anna: 2c + t + s = 13",
    "- Ben: c + 3t + 2s = 19",
    "- Cleo: 3c + 2t + s = 18",
    "",
    "### Solver",
    "",
    "Three linear equations in three unknowns: `numpy.linalg.solve` on the coefficient matrix.",
    "",
    "### Solution",
    "",
    "| item | price (€) |",
    "| --- | --- |",
    ...rows,
    "",
    "### Verification",
    "",
    `Substituting the solution back into all three equations leaves a maximum residual of ${run.result?.maxResidual}.`,
  ].join("\n");
}
