import { describe, expect, it } from "vitest";
import { generateSeedData } from "../src/db/seed-data.js";
import { buildQuestions } from "./build-questions.js";
import { QUESTIONS } from "./questions.js";

describe("committed questions", () => {
  it("match what the seed data produces", () => {
    expect(QUESTIONS).toEqual(buildQuestions(generateSeedData()));
  });

  it("are five, with unique ids and at least one expected value each", () => {
    expect(QUESTIONS).toHaveLength(5);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(5);
    for (const question of QUESTIONS) {
      expect(question.expected.length).toBeGreaterThanOrEqual(1);
      for (const value of question.expected) {
        expect(value.trim()).not.toBe("");
      }
    }
  });

  it("never give the answer away in the question", () => {
    for (const question of QUESTIONS) {
      for (const value of question.expected) {
        if (!/^\d+$/.test(value)) {
          expect(question.question).not.toContain(value);
        }
      }
    }
  });
});
