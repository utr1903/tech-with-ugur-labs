/** The outcome of one question on one model. */
export type CellResult = {
  questionId: string;
  model: string;
  passed: boolean;
  reason: string;
};

const NOT_RUN = "not run";

/**
 * Renders the pass/fail grid: questions down, models across, followed by the
 * reason for each failure and the total.
 */
export function renderGrid(
  results: CellResult[],
  questionIds: string[],
  models: string[],
): string {
  const find = (questionId: string, model: string) =>
    results.find((r) => r.questionId === questionId && r.model === model);
  const firstColumn = Math.max(8, ...questionIds.map((id) => id.length)) + 2;
  const width = Math.max(4, ...models.map((model) => model.length)) + 2;

  const header =
    "question".padEnd(firstColumn) +
    models.map((model) => model.padEnd(width)).join("");
  const rows = questionIds.map(
    (id) =>
      id.padEnd(firstColumn) +
      models
        .map((model) =>
          (find(id, model)?.passed ? "PASS" : "FAIL").padEnd(width),
        )
        .join(""),
  );
  const failures = questionIds.flatMap((id) =>
    models
      .filter((model) => !find(id, model)?.passed)
      .map(
        (model) => `${id} on ${model}: ${find(id, model)?.reason ?? NOT_RUN}`,
      ),
  );
  const total = questionIds.length * models.length;
  const passed = total - failures.length;

  return [
    header.trimEnd(),
    "-".repeat(header.trimEnd().length),
    ...rows.map((row) => row.trimEnd()),
    "",
    ...failures,
    `${passed} of ${total} passed`,
  ].join("\n");
}
