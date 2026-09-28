// Unit tests for the pure summary logic: parsing, malformed detection,
// blank/CRLF handling, top-path ordering and the nearest-rank p95.
import { describe, expect, it } from "vitest";
import { nearestRankP95, parseLine, summarize } from "./summarize.js";

describe("parseLine", () => {
  it("parses a valid line, stripping the query string from the path", () => {
    const line =
      '10.0.0.1 - alice [28/Sep/2026:10:00:01 +0000] "GET /api/users?page=2 HTTP/1.1" 200 512 12.5';
    expect(parseLine(line)).toEqual({
      path: "/api/users",
      status: 200,
      durationMs: 12.5,
    });
  });

  it("rejects a status above 599", () => {
    const line = '1.1.1.1 - - [t] "GET /x HTTP/1.1" 600 1 5';
    expect(parseLine(line)).toBeNull();
  });

  it("rejects a status below 100", () => {
    const line = '1.1.1.1 - - [t] "GET /x HTTP/1.1" 099 1 5';
    expect(parseLine(line)).toBeNull();
  });

  it("rejects a line that is not an access-log entry at all", () => {
    expect(parseLine("this line is not an access log entry")).toBeNull();
  });

  it("accepts a dash for bytes", () => {
    const line = '10.0.0.1 - - [t] "GET /health HTTP/1.1" 204 - 1';
    expect(parseLine(line)?.path).toBe("/health");
  });
});

describe("nearestRankP95", () => {
  it("returns null for an empty series", () => {
    expect(nearestRankP95([])).toBeNull();
  });

  it("takes the nearest-rank value, not an interpolation or the maximum", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    // ceil(0.95 * 20) = 19th smallest value, distinct from 19.05 or 20.
    expect(nearestRankP95(values)).toBe(19);
  });

  it("handles a single value", () => {
    expect(nearestRankP95([7])).toBe(7);
  });
});

describe("summarize", () => {
  it("ignores blank and whitespace-only lines entirely", () => {
    const text = [
      '1.1.1.1 - - [t] "GET /a HTTP/1.1" 200 1 5',
      "",
      "   ",
      '1.1.1.1 - - [t] "GET /a HTTP/1.1" 200 1 5',
    ].join("\n");
    const result = summarize(text);
    expect(result.totalLines).toBe(2);
    expect(result.validRequests).toBe(2);
    expect(result.malformedLines).toBe(0);
  });

  it("handles CRLF line endings", () => {
    const text = '1.1.1.1 - - [t] "GET /a HTTP/1.1" 200 1 5\r\n1.1.1.1 - - [t] "GET /b HTTP/1.1" 200 1 6\r\n';
    const result = summarize(text);
    expect(result.totalLines).toBe(2);
    expect(result.validRequests).toBe(2);
  });

  it("counts malformed lines and keeps them out of validRequests", () => {
    const text = [
      "garbage",
      '1.1.1.1 - - [t] "GET /a HTTP/1.1" 600 1 5',
      '1.1.1.1 - - [t] "GET /a HTTP/1.1" 200 1 5',
    ].join("\n");
    const result = summarize(text);
    expect(result.totalLines).toBe(3);
    expect(result.malformedLines).toBe(2);
    expect(result.validRequests).toBe(1);
  });

  it("reports all five status classes even when some are zero", () => {
    const text = '1.1.1.1 - - [t] "GET /a HTTP/1.1" 200 1 5\n';
    const result = summarize(text);
    expect(result.statusClasses).toEqual({
      "1xx": 0,
      "2xx": 1,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
    });
  });

  it("truncates topPaths to 5, breaking ties by path ascending", () => {
    const lines = [
      ...Array(2).fill('1.1.1.1 - - [t] "GET /z HTTP/1.1" 200 1 1'),
      ...Array(1).fill('1.1.1.1 - - [t] "GET /a HTTP/1.1" 200 1 1'),
      ...Array(1).fill('1.1.1.1 - - [t] "GET /b HTTP/1.1" 200 1 1'),
      ...Array(1).fill('1.1.1.1 - - [t] "GET /c HTTP/1.1" 200 1 1'),
      ...Array(1).fill('1.1.1.1 - - [t] "GET /d HTTP/1.1" 200 1 1'),
      ...Array(1).fill('1.1.1.1 - - [t] "GET /e HTTP/1.1" 200 1 1'),
    ];
    const result = summarize(lines.join("\n"));
    expect(result.topPaths).toEqual([
      { path: "/z", count: 2 },
      { path: "/a", count: 1 },
      { path: "/b", count: 1 },
      { path: "/c", count: 1 },
      { path: "/d", count: 1 },
    ]);
  });

  it("returns null p95 and an empty topPaths for empty input", () => {
    const result = summarize("");
    expect(result.totalLines).toBe(0);
    expect(result.validRequests).toBe(0);
    expect(result.malformedLines).toBe(0);
    expect(result.topPaths).toEqual([]);
    expect(result.p95LatencyMs).toBeNull();
  });
});
