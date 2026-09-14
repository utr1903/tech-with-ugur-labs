import { z } from "zod";
import type { Logger } from "../logger.js";

const executionSchema = z.object({
  status: z.enum(["succeeded", "failed", "timed_out"]),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  result: z.unknown(),
  resultError: z.string().nullable(),
  durationMs: z.number(),
  truncated: z.boolean(),
});

type SandboxExecution = z.infer<typeof executionSchema>;

export type ExecuteOutcome =
  | { kind: "executed"; execution: SandboxExecution }
  | { kind: "busy" }
  | { kind: "rejected"; message: string }
  | { kind: "unreachable"; message: string };

export interface ExecuteClient {
  execute(code: string): Promise<ExecuteOutcome>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function assertClientTimeoutExceedsExecution(
  clientTimeoutMs: number,
  executionTimeoutSeconds: number,
): void {
  if (clientTimeoutMs <= executionTimeoutSeconds * 1000) {
    throw new Error(
      `SANDBOX_CLIENT_TIMEOUT_MS (${clientTimeoutMs}) must be longer than the sandbox execution timeout (${executionTimeoutSeconds}s) so the sandbox reports timed_out itself`,
    );
  }
}

async function toOutcome(response: Response): Promise<ExecuteOutcome> {
  if (response.status === 429) return { kind: "busy" };
  if (response.status === 400) {
    const body = z
      .object({ message: z.string() })
      .safeParse(await response.json().catch(() => null));
    return {
      kind: "rejected",
      message: body.success
        ? body.data.message
        : "the sandbox rejected the code",
    };
  }
  if (!response.ok)
    return {
      kind: "unreachable",
      message: `sandbox answered HTTP ${response.status}`,
    };
  const parsed = executionSchema.safeParse(
    await response.json().catch(() => null),
  );
  return parsed.success
    ? { kind: "executed", execution: parsed.data }
    : {
        kind: "unreachable",
        message: "sandbox returned an unexpected response",
      };
}

// One synchronous POST per tool call. This deliberately breaks the
// log-and-rethrow rule: the tool hands sandbox failures to the model as
// structured content rather than ending the agent run, so failures become
// outcomes here instead of exceptions.
export function createExecuteClient({
  sandboxUrl,
  timeoutMs,
  logger,
  fetchImpl = fetch,
}: {
  sandboxUrl: string;
  timeoutMs: number;
  logger: Logger;
  fetchImpl?: FetchLike;
}): ExecuteClient {
  const url = new URL("/execute", sandboxUrl).toString();
  return {
    async execute(code) {
      const startedAt = Date.now();
      logger.info({ codeChars: code.length }, "Executing code in sandbox...");
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const outcome = await toOutcome(response);
        const durationMs = Date.now() - startedAt;
        if (outcome.kind === "executed")
          logger.info(
            {
              kind: outcome.kind,
              status: outcome.execution.status,
              durationMs,
            },
            "Executing code in sandbox succeeded.",
          );
        else
          logger.warn(
            { kind: outcome.kind, durationMs },
            "Executing code in sandbox failed.",
          );
        return outcome;
      } catch (err) {
        logger.error(
          { err, durationMs: Date.now() - startedAt },
          "Executing code in sandbox failed.",
        );
        return {
          kind: "unreachable",
          message: "the sandbox could not be reached or did not answer in time",
        };
      }
    },
  };
}
