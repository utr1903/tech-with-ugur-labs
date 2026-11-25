import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { isValidScenario, loadStage, renderStage } from "./stage.js";

const logger = createLogger({ appName: "test" });

describe("renderStage", () => {
  it("replaces every __ATTACKER__ occurrence", () => {
    const out = renderStage(
      "a __ATTACKER__ b http://__ATTACKER__:8080",
      "172.18.0.9",
    );
    expect(out).toBe("a 172.18.0.9 b http://172.18.0.9:8080");
  });
});

describe("isValidScenario", () => {
  it("accepts well-formed names and rejects traversal", () => {
    expect(isValidScenario("s1-ssrf-exfil")).toBe(true);
    expect(isValidScenario("../etc")).toBe(false);
    expect(isValidScenario("s1-../x")).toBe(false);
    expect(isValidScenario("S1-Upper")).toBe(false);
  });
});

describe("loadStage", () => {
  it("serves and renders a fixture, 404s otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scn-"));
    await mkdir(join(dir, "s1-demo"));
    await writeFile(join(dir, "s1-demo", "stage.sh"), "curl __ATTACKER__\n");
    expect(await loadStage(logger, dir, "s1-demo", "10.0.0.5")).toBe(
      "curl 10.0.0.5\n",
    );
    expect(await loadStage(logger, dir, "s2-missing", "10.0.0.5")).toBeNull();
    expect(await loadStage(logger, dir, "../x", "10.0.0.5")).toBeNull();
  });
});
