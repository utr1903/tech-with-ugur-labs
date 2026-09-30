import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { expect, it } from "vitest";
import {
  ScriptedModel,
  call,
  finish,
  harness,
  plan,
} from "../research/agent-test-utils.js";
import { runReport } from "./report.js";

it("runs research from both inputs and replaces report and coverage outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-command-"));
  try {
    const urlsFile = join(directory, "urls.txt");
    await writeFile(urlsFile, "https://other.org/b\n");
    await writeFile(join(directory, "report.md"), "stale");
    const h = harness(["https://example.com/a", "https://other.org/b"]);
    const model = new ScriptedModel([
      plan(),
      call("read_page", { url: "https://example.com/a" }),
      call("read_page", { url: "https://other.org/b" }),
      finish(),
    ]);
    const result = await runReport("Read https://example.com/a", h.logger, {
      urlsFile,
      outputDirectory: directory,
      createRuntime: (request) => {
        expect(request.requestedUrls.map(({ url }) => url)).toEqual([
          "https://example.com/a",
          "https://other.org/b",
        ]);
        return { tools: h.tools, model };
      },
    });
    expect(result.exitCode, JSON.stringify(result.coverage)).toBe(0);
    expect(await readFile(join(directory, "report.md"), "utf8")).toContain(
      "Status: Complete",
    );
    expect(
      JSON.parse(await readFile(join(directory, "coverage.json"), "utf8")),
    ).toMatchObject({
      status: "complete",
      requestedUrls: [{ outcome: "read" }, { outcome: "read" }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("writes a partial result when runtime configuration fails without exposing provider errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-command-"));
  try {
    const result = await runReport(
      "Read https://example.com/a",
      pino({ level: "silent" }),
      {
        urlsFile: join(directory, "missing"),
        outputDirectory: directory,
        createRuntime: () => {
          throw new Error("sk-secret-provider-error");
        },
      },
    );
    expect(result.exitCode).toBe(1);
    const output = await readFile(join(directory, "coverage.json"), "utf8");
    expect(output).toContain("configuration");
    expect(output).not.toContain("sk-secret");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects a missing research instruction", async () => {
  await expect(runReport("  ", pino({ level: "silent" }))).rejects.toThrow();
});
