import { describe, expect, it } from "vitest";
import {
  CAFE_PROBLEM,
  CAFE_SOLVER_CODE,
  renderCafeAnswer,
} from "./cafe-script.js";

const succeeded = JSON.stringify({
  status: "succeeded",
  exitCode: 0,
  stdout: "solution: {'coffee': 3.0, 'tea': 2.0, 'sandwich': 5.0}\n",
  stderr: "",
  result: {
    solution: { coffee: 3, tea: 2, sandwich: 5 },
    maxResidual: 1.8e-15,
  },
  resultError: null,
  durationMs: 412,
  truncated: false,
});

describe("cafe script", () => {
  it("states the problem and solves it with numpy.linalg.solve writing result.json", () => {
    expect(CAFE_PROBLEM).toContain("Anna pays €13");
    expect(CAFE_SOLVER_CODE).toContain("np.linalg.solve");
    expect(CAFE_SOLVER_CODE).toContain("result.json");
  });

  it("renders the four sections with prices taken from the tool result", () => {
    const answer = renderCafeAnswer(succeeded);
    const headings = [
      "### Model",
      "### Solver",
      "### Solution",
      "### Verification",
    ];
    const positions = headings.map((h) => answer.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(answer).toContain("| coffee | 3 |");
    expect(answer).toContain("| tea | 2 |");
    expect(answer).toContain("| sandwich | 5 |");
    expect(answer).toContain("1.8e-15");
  });

  it("uses whatever numbers the tool returned, not hardcoded ones", () => {
    const other = JSON.stringify({
      status: "succeeded",
      result: {
        solution: { coffee: 4, tea: 1.5, sandwich: 6 },
        maxResidual: 0,
      },
    });
    expect(renderCafeAnswer(other)).toContain("| tea | 1.5 |");
  });

  it("refuses to give prices when the run failed or the content is not JSON", () => {
    const failed = JSON.stringify({ status: "failed", result: null });
    expect(renderCafeAnswer(failed)).not.toContain("### Solution");
    expect(renderCafeAnswer(failed)).toContain("failed");
    expect(renderCafeAnswer("not json")).toContain("unreadable");
    const busy = JSON.stringify({ error: "sandbox_busy", message: "busy" });
    expect(renderCafeAnswer(busy)).toContain("sandbox_busy");
  });
});
