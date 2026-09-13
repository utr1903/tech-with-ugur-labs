import { Hono } from "hono";
import { ExecutionError, type ExecutionService } from "../execution/types.js";
import { safeExecutionError } from "../lib/errors.js";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";

async function readMessage(request: Request): Promise<string> {
  if (!request.body) throw new ExecutionError("input");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      // Count streamed bytes before parsing so missing Content-Length cannot
      // bypass the request budget or allocate an unbounded JSON body.
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new ExecutionError("input");
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    // Validate input shape; execution deliberately interprets shell syntax later.
    if (
      typeof body !== "object" ||
      body === null ||
      !("message" in body) ||
      typeof body.message !== "string" ||
      !body.message.trim()
    )
      throw new ExecutionError("input");
    return body.message;
  } catch {
    throw new ExecutionError("input");
  } finally {
    reader.releaseLock();
  }
}

export function createApp(service: ExecutionService, logger: Logger): Hono {
  const app = new Hono();
  app.post("/execute", async (context) => {
    try {
      logger.info({ method: "POST", path: "/execute" }, "Execute request...");
      const message = await operation(
        logger,
        "Validate execution request",
        { maximumBytes: 8192 },
        () => readMessage(context.req.raw),
        (message) => ({ commandBytes: Buffer.byteLength(message) }),
      );
      const result = await service.execute(message);
      logger.info(
        { id: result.id, exitCode: result.exitCode },
        "Execute request succeeded.",
      );
      return context.json(result, 200);
    } catch (err) {
      // Nonzero shell exits are ordinary results. Only invalid input, timeout and
      // infrastructure/collection failures become generic HTTP errors.
      const failure = safeExecutionError(err);
      logger.error({ err: failure }, "Execute request failed.");
      const status = { input: 400, timeout: 504, infrastructure: 500 } as const;
      return context.json({ error: failure.message }, status[failure.kind]);
    }
  });
  return app;
}
