import type { Capabilities } from "./capabilities.js";

export function installedModulesLine(capabilities: Capabilities): string {
  const modules = capabilities.modules.map(
    (m) => `${m.importName} (${m.distribution} ${m.version})`,
  );
  return `Installed modules: ${modules.join(", ")}.`;
}

// Generated from the sandbox's own /capabilities so every claim the model
// reads is true of the image that will run its code.
export function describeCodeExecutor(capabilities: Capabilities): string {
  const { limits } = capabilities;
  return [
    "Runs a complete Python program in an isolated sandbox and returns its status, exit code, stdout, stderr and an optional structured result.",
    "Use for: every calculation — arithmetic, solving equations or linear systems, optimisation, fitting, statistics, symbolic maths and checking a proposed answer.",
    "Do NOT use for: fetching data from the internet, installing packages, keeping state between calls, or work that needs longer than the timeout.",
    `Environment: Python ${capabilities.pythonVersion}, standard library plus the modules below.`,
    installedModulesLine(capabilities),
    `Limits: wall-clock timeout ${limits.executionTimeoutSeconds} s; stdout truncated after ${limits.maxStdoutBytes} bytes and stderr after ${limits.maxStderrBytes} bytes; code at most ${limits.maxCodeBytes} bytes; at most ${limits.maxConcurrentExecutions} executions run at once.`,
    capabilities.network,
    capabilities.persistence,
    capabilities.structuredResult,
    "Response: JSON with status (succeeded | failed | timed_out), exitCode, stdout, stderr, result (parsed result.json or null), resultError, durationMs and truncated. If the sandbox is busy or unreachable you get {error, message}: retry once, then tell the user.",
  ].join("\n");
}
