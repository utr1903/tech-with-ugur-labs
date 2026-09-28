import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AnswerQuestion } from "../agent/answer.js";
import { createApp } from "./app.js";
import { INTERNAL_ERROR } from "./http-error.js";

const answered: AnswerQuestion = async () => ({ answer: "", toolCalls: [] });

describe("onError", () => {
  it("answers with the shared internal-error response and never leaks a local path", async () => {
    const lines: string[] = [];
    const capturing = pino(
      { level: "info" },
      { write: (line: string) => lines.push(line) },
    );
    const app = createApp({ answerQuestion: answered, logger: capturing });
    app.get("/boom", () => {
      throw new Error("boom /home/node/.aws/y");
    });

    const response = await app.request("/boom");

    expect(response.status).toBe(INTERNAL_ERROR.status);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: INTERNAL_ERROR.code, message: INTERNAL_ERROR.message },
    });
    expect(JSON.stringify(body)).not.toContain(".aws");
    expect(lines.join("")).not.toContain(".aws");
  });
});
