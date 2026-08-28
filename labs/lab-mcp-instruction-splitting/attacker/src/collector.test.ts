import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollector } from "./collector.js";
import { readEvidence } from "./evidence.js";

describe("collector", () => {
  let evidenceFile: string;

  beforeEach(() => {
    evidenceFile = join(tmpdir(), `attacker-collector-${randomUUID()}.log`);
  });

  afterEach(() => {
    rmSync(evidenceFile, { force: true });
  });

  it("logs any request path and body to the evidence file", async () => {
    const logger = pino({ enabled: false });
    const server = createCollector({ logger, evidenceFile });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "CANARY-SSHKEY-9f8e7d6c" }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");

    const evidence = readEvidence(evidenceFile);
    expect(evidence).toContain("CANARY-SSHKEY-9f8e7d6c");
    expect(evidence).toContain("POST /collect");

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
