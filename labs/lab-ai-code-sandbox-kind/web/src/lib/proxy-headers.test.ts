import { describe, expect, it } from "vitest";
import {
  downstreamResponseHeaders,
  upstreamRequestHeaders,
} from "./proxy-headers";

describe("proxy headers", () => {
  it("drops hop-by-hop and host headers going upstream", () => {
    const out = upstreamRequestHeaders(
      new Headers({
        host: "x",
        connection: "keep-alive",
        "content-type": "application/json",
        "content-length": "10",
      }),
    );
    expect(out.get("host")).toBeNull();
    expect(out.get("connection")).toBeNull();
    expect(out.get("content-length")).toBeNull();
    expect(out.get("content-type")).toBe("application/json");
  });

  it("drops encoding and length headers coming back (fetch already decoded the body)", () => {
    const out = downstreamResponseHeaders(
      new Headers({
        "content-encoding": "gzip",
        "content-length": "5",
        "content-type": "text/event-stream",
        "transfer-encoding": "chunked",
      }),
    );
    expect(out.get("content-encoding")).toBeNull();
    expect(out.get("content-length")).toBeNull();
    expect(out.get("transfer-encoding")).toBeNull();
    expect(out.get("content-type")).toBe("text/event-stream");
  });
});
