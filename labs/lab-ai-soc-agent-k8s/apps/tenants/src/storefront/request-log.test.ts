import { describe, expect, it } from "vitest";
import { toRequestLogFields } from "./request-log.js";

describe("toRequestLogFields", () => {
  it("falls back to the socket address and strips the ::ffff: prefix", () => {
    const fields = toRequestLogFields({
      method: "GET",
      url: "/preview?url=http%3A%2F%2Fa",
      headers: { "user-agent": "curl/8" },
      socket: { remoteAddress: "::ffff:172.18.0.1" },
    });
    expect(fields).toEqual({
      method: "GET",
      path: "/preview",
      query: "url=http%3A%2F%2Fa",
      srcIp: "172.18.0.1",
      userAgent: "curl/8",
    });
  });

  it("prefers x-forwarded-for when present", () => {
    const fields = toRequestLogFields({
      method: "GET",
      url: "/products",
      headers: { "x-forwarded-for": "10.1.2.3, 10.9.9.9" },
      socket: { remoteAddress: "172.18.0.1" },
    });
    expect(fields.srcIp).toBe("10.1.2.3");
    expect(fields.userAgent).toBe("");
  });
});
