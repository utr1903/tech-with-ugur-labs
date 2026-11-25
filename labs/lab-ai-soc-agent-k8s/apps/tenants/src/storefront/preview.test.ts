import { describe, expect, it, vi } from "vitest";
import { buildPreviewCommand, runPreview } from "./preview.js";

const logger = { info: vi.fn(), error: vi.fn() } as never;

describe("buildPreviewCommand", () => {
  it("wraps the url in a curl HEAD request", () => {
    expect(buildPreviewCommand("http://a/b")).toBe(
      "curl -sI --max-time 5 http://a/b",
    );
  });

  it("is injectable by design", () => {
    expect(buildPreviewCommand("x;id")).toContain(";id");
  });
});

describe("runPreview", () => {
  it("returns the status and first header line", async () => {
    const exec = async () => ({ stdout: "HTTP/1.1 200 OK\r\nServer: x\r\n" });
    expect(await runPreview(logger, "http://a", exec)).toEqual({
      status: 200,
      firstLine: "HTTP/1.1 200 OK",
    });
  });

  it("returns status 0 when curl printed nothing", async () => {
    const exec = async () => ({ stdout: "" });
    expect(await runPreview(logger, "http://a", exec)).toEqual({
      status: 0,
      firstLine: "",
    });
  });
});
