import { describe, it, expect } from "vitest";
import { buildCollector } from "../src/server.js";

describe("collector", () => {
  it("records a leak and returns it per phase+pos", async () => {
    const app = buildCollector();
    await app.inject({ method: "GET", url: "/leak?phase=vuln&pos=0&c=a&n=1" });

    const events = await app.inject({ method: "GET", url: "/events?phase=vuln&pos=0" });
    expect(events.json()).toEqual({ chars: ["a"] });

    const count = await app.inject({ method: "GET", url: "/count?phase=vuln" });
    expect(count.json()).toEqual({ count: 1 });
  });

  it("returns a gif from /leak", async () => {
    const app = buildCollector();
    const res = await app.inject({ method: "GET", url: "/leak?phase=vuln&pos=0&c=a&n=1" });
    expect(res.headers["content-type"]).toContain("image/gif");
  });

  it("reset clears a phase", async () => {
    const app = buildCollector();
    await app.inject({ method: "GET", url: "/leak?phase=vuln&pos=0&c=a&n=1" });
    await app.inject({ method: "POST", url: "/reset", payload: { phase: "vuln" } });
    const count = await app.inject({ method: "GET", url: "/count?phase=vuln" });
    expect(count.json()).toEqual({ count: 0 });
  });
});
