export type SandboxResultView =
  | { kind: "pending" }
  | { kind: "error"; message: string }
  | {
      kind: "execution";
      status: "succeeded" | "failed" | "timed_out";
      exitCode: number | null;
      stdout: string;
      stderr: string;
      result: unknown;
      resultError: string | null;
      durationMs: number;
      truncated: boolean;
    };

function asObject(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === "string") {
    try {
      return asObject(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : undefined;
}

export function parseSandboxResult(raw: unknown): SandboxResultView {
  if (raw === undefined) return { kind: "pending" };
  const value = asObject(raw);
  if (!value) return { kind: "error", message: "unreadable tool result" };
  if (typeof value.error === "string")
    return {
      kind: "error",
      message: `${value.error}: ${String(value.message ?? "")}`,
    };
  if (
    value.status === "succeeded" ||
    value.status === "failed" ||
    value.status === "timed_out"
  ) {
    return {
      kind: "execution",
      status: value.status,
      exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
      stdout: String(value.stdout ?? ""),
      stderr: String(value.stderr ?? ""),
      result: value.result ?? null,
      resultError:
        typeof value.resultError === "string" ? value.resultError : null,
      durationMs: Number(value.durationMs ?? 0),
      truncated: value.truncated === true,
    };
  }
  return { kind: "error", message: "unreadable tool result" };
}
