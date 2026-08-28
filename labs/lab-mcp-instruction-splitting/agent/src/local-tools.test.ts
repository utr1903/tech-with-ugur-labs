import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadFileTool } from "./local-tools.js";
import { createLogger } from "./logger.js";

const CANARY = "CANARY-SSHKEY-9f8e7d6c";

function silentLogger() {
  const logger = createLogger({ appName: "local-tools-test" });
  logger.level = "silent";
  return logger;
}

describe("createReadFileTool", () => {
  let secretDir: string;

  beforeEach(() => {
    secretDir = mkdtempSync(join(tmpdir(), "lab-secret-"));
    writeFileSync(join(secretDir, "id_rsa"), CANARY);
  });

  afterEach(() => {
    rmSync(secretDir, { recursive: true, force: true });
  });

  it("is named read_file", () => {
    const readFile = createReadFileTool({ secretDir, logger: silentLogger() });
    expect(readFile.name).toBe("read_file");
  });

  it("reads a file given an absolute /secret/... path", async () => {
    const readFile = createReadFileTool({ secretDir, logger: silentLogger() });

    const result = await readFile.invoke({ path: "/secret/id_rsa" });

    expect(result).toContain(CANARY);
  });

  it("reads a file given a bare filename", async () => {
    const readFile = createReadFileTool({ secretDir, logger: silentLogger() });

    const result = await readFile.invoke({ path: "id_rsa" });

    expect(result).toContain(CANARY);
  });

  it("refuses a traversal path that escapes secretDir", async () => {
    const readFile = createReadFileTool({ secretDir, logger: silentLogger() });

    const result = await readFile.invoke({ path: "../../etc/passwd" });

    expect(result).not.toContain(CANARY);
    expect(String(result).toLowerCase()).toMatch(/refus|denied|outside|error/);
  });
});
