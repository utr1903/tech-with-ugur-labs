import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.js";

describe("parseCliArgs", () => {
  it("parses the replay positionals and the delay flag", () => {
    expect(parseCliArgs(["replay", "/runs/1", "--delay-ms", "50"])).toEqual({
      command: "replay",
      runDir: "/runs/1",
      outFile: undefined,
      delayMs: 50,
      acceptanceDir: null,
    });
  });

  it("parses the verify positionals and the acceptance flag", () => {
    expect(
      parseCliArgs([
        "verify",
        "/runs/1",
        "/out/verdict.json",
        "--acceptance",
        "/tasks/x",
      ]),
    ).toEqual({
      command: "verify",
      runDir: "/runs/1",
      outFile: "/out/verdict.json",
      delayMs: 0,
      acceptanceDir: "/tasks/x",
    });
  });

  it("defaults delayMs to 0 and acceptanceDir to null", () => {
    expect(parseCliArgs(["watch", "/runs/1"])).toEqual({
      command: "watch",
      runDir: "/runs/1",
      outFile: undefined,
      delayMs: 0,
      acceptanceDir: null,
    });
  });
});
