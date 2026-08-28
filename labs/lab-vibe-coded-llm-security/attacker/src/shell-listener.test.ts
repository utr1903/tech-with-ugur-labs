import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEvidence } from "./evidence.js";
import { CANARY_PROBE, createShellListener } from "./shell-listener.js";

describe("shell-listener", () => {
  let evidenceFile: string;

  beforeEach(() => {
    evidenceFile = join(tmpdir(), `attacker-shell-${randomUUID()}.log`);
  });

  afterEach(() => {
    rmSync(evidenceFile, { force: true });
  });

  it("drives the canary probe and captures the reverse-shell response", async () => {
    const logger = pino({ enabled: false });
    const server = createShellListener({ logger, evidenceFile });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ port }, () => undefined);
      socket.on("data", (data) => {
        expect(data.toString("utf8")).toBe(CANARY_PROBE);
        socket.end("uid=0(root) RCE-CANARY-e5f6a7b8\n");
      });
      socket.on("close", () => resolve());
      socket.on("error", reject);
    });

    const evidence = readEvidence(evidenceFile);
    expect(evidence).toContain("RCE-CANARY-e5f6a7b8");

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
