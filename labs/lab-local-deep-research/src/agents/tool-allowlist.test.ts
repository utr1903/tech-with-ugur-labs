import { describe, expect, it } from "vitest";
import { createToolAllowlistMiddleware } from "./tool-allowlist.js";

interface NamedTool {
  name: string;
}

describe("createToolAllowlistMiddleware", () => {
  it("removes tools that are not on the allowlist before the model call", async () => {
    const middleware = createToolAllowlistMiddleware({
      allowedTools: ["read_file"],
    });
    const request = {
      tools: [{ name: "read_file" }, { name: "task" }, { name: "write_file" }],
    };
    let seenTools: NamedTool[] = [];
    const handler = (modified: { tools: NamedTool[] }) => {
      seenTools = modified.tools;
      return Promise.resolve({});
    };
    await (
      middleware.wrapModelCall as (r: unknown, h: unknown) => Promise<unknown>
    )(request, handler);
    expect(seenTools.map((t) => t.name)).toEqual(["read_file"]);
  });
});
