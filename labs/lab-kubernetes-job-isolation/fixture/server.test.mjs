import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("serves exact harmless script bytes and records path/source without executing it", async () => {
  const child = spawn(process.execPath, ["fixture/server.mjs"], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  try {
    for (let i = 0; i < 100 && !logs.includes("listening"); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const entry = logs
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.event === "listening");
    assert.ok(entry, "fixture listener must become ready");
    const response = await fetch(`http://127.0.0.1:${entry.port}/marker.sh`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/plain");
    assert.equal(
      await response.text(),
      "printf 'SIMULATED_DOWNLOAD_MARKER\\n'\n",
    );
    const absent = await fetch(`http://127.0.0.1:${entry.port}/health`);
    assert.equal(absent.status, 404);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const request = logs
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.path === "/marker.sh");
    assert.equal(typeof request.timestamp, "string");
    assert.match(request.source, /127\.0\.0\.1/);
    const records = logs
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(
      records.filter((line) => line.path === "/marker.sh").length,
      1,
    );
    const served = records.filter(
      (line) =>
        line.operation === "Serving fixture request" &&
        line.requestId === request.requestId,
    );
    assert.deepEqual(
      served.map((line) => line.level),
      ["info", "info"],
    );
    assert.equal(served[1].status, 200);
    assert.equal(
      served[1].bytes,
      Buffer.byteLength("printf 'SIMULATED_DOWNLOAD_MARKER\\n'\n"),
    );
    assert.ok(!logs.split("\n").includes("SIMULATED_DOWNLOAD_MARKER"));
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});
