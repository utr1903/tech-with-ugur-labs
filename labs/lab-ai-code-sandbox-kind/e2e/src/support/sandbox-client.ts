import { z } from "zod";
import { SANDBOX_URL } from "./cluster.js";

// The sandbox's JSON contract. Strict objects: an extra or missing field is a
// contract change the suite should notice.
const executionSchema = z.strictObject({
  status: z.enum(["succeeded", "failed", "timed_out"]),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  result: z.unknown(),
  resultError: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

const capabilitiesSchema = z.strictObject({
  pythonVersion: z.string(),
  modules: z.array(
    z.strictObject({
      importName: z.string(),
      distribution: z.string(),
      version: z.string(),
    }),
  ),
  limits: z.strictObject({
    executionTimeoutSeconds: z.number(),
    maxCodeBytes: z.number().int(),
    maxStdoutBytes: z.number().int(),
    maxStderrBytes: z.number().int(),
    maxResultBytes: z.number().int(),
    maxConcurrentExecutions: z.number().int(),
  }),
  network: z.string(),
  persistence: z.string(),
  structuredResult: z.string(),
});

export type Execution = z.infer<typeof executionSchema>;
export type CapabilitiesDoc = z.infer<typeof capabilitiesSchema>;

export async function getCapabilities(): Promise<CapabilitiesDoc> {
  const response = await fetch(`${SANDBOX_URL}/capabilities`);
  if (response.status !== 200)
    throw new Error(`capabilities returned HTTP ${response.status}`);
  return capabilitiesSchema.parse(await response.json());
}

interface RawExecuteResponse {
  status: number;
  retryAfter: string | null;
  json: unknown;
  elapsedMs: number;
}

export async function postExecute(body: string): Promise<RawExecuteResponse> {
  const started = Date.now();
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return {
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    json: await response.json(),
    elapsedMs: Date.now() - started,
  };
}

export async function execute(code: string): Promise<Execution> {
  const { status, json } = await postExecute(JSON.stringify({ code }));
  if (status !== 200)
    throw new Error(`execute returned HTTP ${status}: ${JSON.stringify(json)}`);
  return executionSchema.parse(json);
}

export async function expectHealthy(): Promise<void> {
  const run = await execute("print('still healthy')");
  if (run.status !== "succeeded" || run.stdout !== "still healthy\n") {
    throw new Error(
      `sandbox not healthy after the previous check: ${JSON.stringify(run)}`,
    );
  }
}
