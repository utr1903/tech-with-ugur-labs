"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { parseSandboxResult } from "../lib/sandbox-result";

// Shows exactly what ran and what came back: the code, both streams and the
// structured result, so a reader can check the model's answer against it.
export const CodeExecutorCard: ToolCallMessagePartComponent<
  { code?: string },
  unknown
> = ({ args, result }) => {
  const view = parseSandboxResult(result);
  const status =
    view.kind === "pending"
      ? "running"
      : view.kind === "error"
        ? "error"
        : view.status;
  return (
    <section className="tool-card" data-testid="code-executor-card">
      <header className="tool-card-header">
        <span>code_executor</span>
        <span className={`tool-status-${status}`} data-testid="tool-status">
          {status}
        </span>
      </header>
      <pre data-testid="tool-code">
        <code>{args.code ?? ""}</code>
      </pre>
      {view.kind === "error" && (
        <p className="tool-status-error" data-testid="tool-error">
          {view.message}
        </p>
      )}
      {view.kind === "execution" && (
        <>
          {view.stdout && (
            <>
              <h4>stdout</h4>
              <pre data-testid="tool-stdout">{view.stdout}</pre>
            </>
          )}
          {view.stderr && (
            <>
              <h4>stderr</h4>
              <pre data-testid="tool-stderr">{view.stderr}</pre>
            </>
          )}
          {view.result !== null && (
            <>
              <h4>result.json</h4>
              <pre data-testid="tool-result">
                {JSON.stringify(view.result, null, 2)}
              </pre>
            </>
          )}
          {view.resultError && (
            <p className="tool-status-error">{view.resultError}</p>
          )}
          {view.truncated && (
            <p className="thread-empty">Output was truncated.</p>
          )}
          <p className="thread-empty">
            exit code {view.exitCode ?? "—"} · {view.durationMs} ms
          </p>
        </>
      )}
    </section>
  );
};
