// Worker diagnostics go to the container log, never to the captured child pipes.
// This image carries only Node, so use dependency-free JSON rather than installing
// the server's npm dependencies in the shell-execution image.
export function log(level, operation, fields, outcome = "...") {
  const suffix = outcome === "..." ? outcome : ` ${outcome}.`;
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      appName: "job-isolation-worker",
      level,
      operation,
      ...fields,
      message: `${operation}${suffix}`,
    })}\n`,
  );
}

export function failure(err) {
  // Filesystem errors can include result paths or submitted bytes in messages.
  const code =
    typeof err?.code === "string" && /^E[A-Z]{2,20}$/.test(err.code)
      ? err.code
      : undefined;
  return {
    category: code ? "filesystem-or-process" : "infrastructure",
    ...(code ? { code } : {}),
  };
}

// Keep the operation lifecycle consistent while returning the original result or error.
export async function operation(name, fields, body, summary = () => ({})) {
  try {
    log("info", name, fields);
    const result = await body();
    log("info", name, { ...fields, ...summary(result) }, "succeeded");
    return result;
  } catch (err) {
    log("error", name, { ...fields, err: failure(err) }, "failed");
    throw err;
  }
}
