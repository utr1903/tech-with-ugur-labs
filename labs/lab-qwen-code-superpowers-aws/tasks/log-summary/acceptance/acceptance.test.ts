// Hidden acceptance tests for the log-summary task. The verifier runs them
// with `node --test` against a clean copy of the agent's project, given in
// TASK_WORKDIR. Only node: built-ins, so the tests need no install.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const workdir = process.env.TASK_WORKDIR;
if (!workdir) throw new Error("TASK_WORKDIR is not set");

function summarize(args: string[]) {
  return spawnSync("npm", ["run", "--silent", "summarize", "--", ...args], {
    cwd: workdir,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function logFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-"));
  const path = join(dir, "access.log");
  writeFileSync(path, content);
  return path;
}

test("a missing file exits 1 with nothing on stdout", () => {
  const result = summarize(["/nonexistent/access.log"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "");
  assert.notEqual(result.stderr.trim(), "");
});

test("no argument exits 2", () => {
  const result = summarize([]);
  assert.equal(result.status, 2);
});

test("a log of only malformed lines has a null p95", () => {
  const result = summarize([logFile("garbage\nmore garbage\n")]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.totalLines, 2);
  assert.equal(summary.malformedLines, 2);
  assert.equal(summary.validRequests, 0);
  assert.equal(summary.p95LatencyMs, null);
  assert.deepEqual(summary.topPaths, []);
});

test("a status outside 100-599 and a negative-looking duration are malformed", () => {
  const log = [
    '1.1.1.1 - - [t] "GET /x HTTP/1.1" 099 1 5',
    '1.1.1.1 - - [t] "GET /x HTTP/1.1" 600 1 5',
    '1.1.1.1 - - [t] "GET /x HTTP/1.1" 200 1 -5',
    '1.1.1.1 - - [t] "GET /x HTTP/1.1" 200 1 7',
  ].join("\n");
  const summary = JSON.parse(summarize([logFile(log)]).stdout);
  assert.equal(summary.validRequests, 1);
  assert.equal(summary.malformedLines, 3);
  assert.equal(summary.p95LatencyMs, 7);
});

test("the query string is dropped from the path", () => {
  const log = '1.1.1.1 - - [t] "GET /search?q=a?b HTTP/1.1" 200 1 5\n';
  const summary = JSON.parse(summarize([logFile(log)]).stdout);
  assert.deepEqual(summary.topPaths, [{ path: "/search", count: 1 }]);
});
