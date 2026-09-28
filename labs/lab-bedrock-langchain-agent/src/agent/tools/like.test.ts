import { describe, expect, it } from "vitest";
import { escapeLike } from "./like.js";

describe("escapeLike", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeLike("Anna")).toBe("Anna");
  });

  it("escapes the wildcard characters and the escape character", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});
