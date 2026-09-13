import { spawn } from "node:child_process";
import { closeSync, writeSync, fsyncSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { readConfiguration } from "./configuration.mjs";
import { create, verifyPath } from "./result-files.mjs";
import { failure, log, operation } from "./operations.mjs";

let child;
let capture;
let infrastructureError = false;
let stopPromise;
let executionFields = {};
let cleanupSignalFailed = false;
let workerFinished = false;

// Signal shutdown and collection completion race; emit one terminal lifecycle event.
function finishWorker(err) {
  if (workerFinished) return;
  workerFinished = true;
  log(
    err ? "error" : "info",
    "Running worker",
    {
      ...executionFields,
      ...(err ? { err: failure(err) } : {}),
    },
    err ? "failed" : "succeeded",
  );
}

// Stop the shell and descendants that remain in its detached process group.
function signalGroup(signal) {
  if (!child?.pid) return;
  const fields = { ...executionFields, processGroup: child.pid, signal };
  try {
    log("info", "Signaling command process group", fields);
    // Detached spawn makes the shell PID its process-group ID; negative PID
    // signals its descendants too, rather than stopping only the parent shell.
    process.kill(-child.pid, signal);
    log("info", "Signaling command process group", fields, "succeeded");
  } catch (err) {
    if (err.code === "ESRCH") {
      log(
        "info",
        "Signaling command process group",
        { ...fields, alreadyStopped: true },
        "succeeded",
      );
    } else {
      cleanupSignalFailed = true;
      log(
        "error",
        "Signaling command process group",
        { ...fields, err: failure(err) },
        "failed",
      );
      infrastructureError = true;
    }
  }
}

// Share one bounded TERM/KILL sequence across exit, truncation and shutdown paths.
function stopGroup() {
  if (!stopPromise) {
    signalGroup("SIGTERM");
    stopPromise = new Promise((resolve) =>
      setTimeout(() => {
        signalGroup("SIGKILL");
        // Bound draining even if a descendant escaped the original process group.
        // Container termination is still required to clean up such descendants.
        child?.stdout.destroy();
        child?.stderr.destroy();
        resolve();
      }, 150),
    );
  }
  return stopPromise;
}

// Run one detached shell and drain both pipes through the shared bounded capture.
async function runCommand(config, limit) {
  let size = 0;
  let truncated = false;
  const exitCode = await operation(
    "Running shell command",
    executionFields,
    async () => {
      // Only the child executes submitted text. Its two pipes share one capture budget;
      // launcher JSON diagnostics are written separately to the container's stdout.
      child = spawn("/bin/sh", ["-c", config.message], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          stopGroup();
          // Conventional shell status: 128 + the signal number (TERM=143, KILL=137).
          // A normal shell exit is preserved even when background children are killed.
          resolve(code ?? 128 + osConstants.signals[signal]);
        });
      });
      // Both streams spend the same byte budget and handle partial filesystem writes.
      function consume(chunk) {
        if (infrastructureError || truncated) return;
        try {
          const bytes = chunk.subarray(0, limit - size);
          let offset = 0;
          while (offset < bytes.length)
            offset += writeSync(capture, bytes, offset, bytes.length - offset);
          size += bytes.length;
          if (chunk.length > bytes.length) {
            // Stop producing bytes when the combined stdout/stderr limit is exceeded.
            truncated = true;
            stopGroup();
          }
        } catch (err) {
          log(
            "error",
            "Writing command capture",
            { ...executionFields, err: failure(err), capturedBytes: size },
            "failed",
          );
          infrastructureError = true;
          stopGroup();
        }
      }
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      for (const stream of [child.stdout, child.stderr])
        stream.on("error", (err) => {
          log(
            "error",
            "Reading command stream",
            { ...executionFields, err: failure(err) },
            "failed",
          );
          infrastructureError = true;
          stopGroup();
        });
      const exitCode = await exited;
      await stopGroup();
      if (infrastructureError) throw new Error("Execution collection failed");
      return exitCode;
    },
    (exitCode) => ({ exitCode, capturedBytes: size, truncated }),
  );
  return { exitCode, size, truncated };
}

// Collect child streams first, then publish validated output and small exit metadata.
async function main() {
  const { config, limit, outputPath, exitPath } = readConfiguration();
  executionFields = {
    id: config.id,
    command: "/bin/sh",
    args: ["-c", config.message],
    outputPath,
    exitPath,
    limit,
  };
  return operation(
    "Collecting execution results",
    executionFields,
    async () => {
      // Exclusive no-follow creation prevents pre-existing links from redirecting output.
      capture = create(outputPath);
      const { exitCode, size, truncated } = await runCommand(config, limit);
      // Compare the named inode with the held descriptor before trusting the capture.
      // Persist output before publishing metadata; successful metadata means collection
      // completed, while a nonzero user shell exit remains an ordinary result.
      await operation(
        "Publishing execution result files",
        executionFields,
        async () => {
          verifyPath(outputPath, capture, limit);
          fsyncSync(capture);
          closeSync(capture);
          capture = undefined;
          const metadata = create(exitPath);
          try {
            const bytes = Buffer.from(JSON.stringify({ exitCode, truncated }));
            let offset = 0;
            while (offset < bytes.length)
              offset += writeSync(
                metadata,
                bytes,
                offset,
                bytes.length - offset,
              );
            verifyPath(exitPath, metadata, 128);
            fsyncSync(metadata);
          } finally {
            closeSync(metadata);
          }
        },
        () => ({ exitCode, capturedBytes: size, truncated }),
      );
    },
    () => ({ outputPath, exitPath }),
  );
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.on(signal, async () => {
    const fields = { ...executionFields, signal };
    try {
      log("info", "Stopping worker", fields);
      infrastructureError = true;
      await stopGroup();
      // Shutdown completed; exit1 still prevents publishing successful metadata
      // for a command interrupted by the Kubernetes deadline or operator.
      if (cleanupSignalFailed)
        log(
          "error",
          "Stopping worker",
          { ...fields, err: { category: "process-group-signaling" } },
          "failed",
        );
      else log("info", "Stopping worker", fields, "succeeded");
      finishWorker(new Error("Worker interrupted"));
      process.exit(1);
    } catch (err) {
      log(
        "error",
        "Stopping worker",
        { ...fields, err: failure(err) },
        "failed",
      );
      finishWorker(err);
      process.exit(1);
    }
  });

log("info", "Running worker", {});
main()
  .then(() => finishWorker())
  .catch(async (err) => {
    infrastructureError = true;
    await stopGroup();
    if (capture !== undefined) closeSync(capture);
    finishWorker(err);
    process.exitCode = 1;
  });
