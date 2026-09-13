import { createServer } from "node:http";

const marker = "printf 'SIMULATED_DOWNLOAD_MARKER\\n'\n";
let nextRequestId = 0;
// Use container JSON diagnostics without installing application dependencies.
function log(level, operation, fields, outcome = "...") {
  const suffix = outcome === "..." ? outcome : ` ${outcome}.`;
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), appName: "job-isolation-fixture", level, operation, ...fields, message: `${operation}${suffix}` })}\n`,
  );
}
// Keep only a bounded safe diagnostic code rather than serializing backend exceptions.
function diagnostic(err) {
  // Do not echo arbitrary URLs, request data or raw exception messages.
  return {
    category: "fixture",
    ...(typeof err?.code === "string" && /^E[A-Z]{2,20}$/.test(err.code)
      ? { code: err.code }
      : {}),
  };
}
const server = createServer((request, response) => {
  // One path/source event per request is the E2E download counter. Completion
  // events carry the same requestId but omit path so they cannot double-count.
  const path = request.url === "/marker.sh" ? "/marker.sh" : "<other>";
  const requestId = ++nextRequestId;
  const fields = {
    requestId,
    method: request.method,
    source: request.socket.remoteAddress ?? "<unknown>",
  };
  const operation = "Serving fixture request";
  try {
    log("info", operation, { ...fields, path });
    const found = request.method === "GET" && path === "/marker.sh";
    const status = found ? 200 : 404;
    const bytes = found ? Buffer.byteLength(marker) : 0;
    // The fixture only returns fixed bytes; it never invokes a shell or serves
    // filesystem paths chosen by the caller. A 404 is a completed HTTP response.
    response.once("finish", () =>
      log("info", operation, { ...fields, status, bytes }, "succeeded"),
    );
    response.once("error", (err) =>
      log("error", operation, { ...fields, err: diagnostic(err) }, "failed"),
    );
    response.writeHead(status, found ? { "content-type": "text/plain" } : {});
    response.end(found ? marker : undefined);
  } catch (err) {
    log("error", operation, { ...fields, err: diagnostic(err) }, "failed");
    response.destroy();
  }
});
const port = Number(process.env.PORT ?? "8080");
// Readiness is a TCP probe; log success only after the listener actually binds.
server.on("error", (err) => {
  log(
    "error",
    "Starting fixture listener",
    { event: "listener-failed", port, err: diagnostic(err) },
    "failed",
  );
  process.exit(1);
});
try {
  log("info", "Starting fixture listener", { port, host: "0.0.0.0" });
  server.listen(port, "0.0.0.0", () =>
    log(
      "info",
      "Starting fixture listener",
      { event: "listening", port: server.address().port },
      "succeeded",
    ),
  );
} catch (err) {
  log(
    "error",
    "Starting fixture listener",
    { port, err: diagnostic(err) },
    "failed",
  );
  process.exitCode = 1;
}
process.on("SIGTERM", () => {
  try {
    log("info", "Stopping fixture listener", {});
    server.close((err) => {
      if (err) {
        log(
          "error",
          "Stopping fixture listener",
          { err: diagnostic(err) },
          "failed",
        );
        process.exit(1);
      }
      log("info", "Stopping fixture listener", {}, "succeeded");
      process.exit(0);
    });
  } catch (err) {
    log(
      "error",
      "Stopping fixture listener",
      { err: diagnostic(err) },
      "failed",
    );
    process.exit(1);
  }
});
