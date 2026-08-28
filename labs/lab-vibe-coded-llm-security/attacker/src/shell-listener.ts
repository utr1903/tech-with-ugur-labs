import net from "node:net";
import { appendEvidence } from "./evidence.js";
import type { Logger } from "./logger.js";

export const CANARY_PROBE = "id; echo RCE-CANARY-e5f6a7b8; exit\n";

export function createShellListener(deps: {
  logger: Logger;
  evidenceFile: string;
}): net.Server {
  const { logger, evidenceFile } = deps;

  return net.createServer((socket) => {
    logger.info("Caught a reverse shell...");
    socket.write(CANARY_PROBE);

    socket.on("data", (chunk: Buffer) => {
      appendEvidence(evidenceFile, chunk.toString("utf8"));
    });
  });
}
