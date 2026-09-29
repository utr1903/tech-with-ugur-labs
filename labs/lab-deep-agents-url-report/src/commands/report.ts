import type { Logger } from "../logger.js";
import { type ResearchRequest, readRequest } from "../research/input.js";

export async function runReport(
  instruction: string,
  logger: Logger,
  urlsFile = "workspace/input/urls.txt",
): Promise<ResearchRequest> {
  try {
    logger.info(
      { urlsFile, instructionLength: instruction.length },
      "Reading research request...",
    );
    if (!instruction.trim())
      throw new Error("A research instruction is required.");
    const request = await readRequest(instruction, urlsFile);
    logger.info(
      {
        requestedCount: request.requestedUrls.length,
        invalidCount: request.invalidEntries.length,
      },
      "Reading research request succeeded.",
    );
    return request;
  } catch (err) {
    logger.error({ err, urlsFile }, "Reading research request failed.");
    throw err;
  }
}
