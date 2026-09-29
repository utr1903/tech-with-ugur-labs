import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { expect, it } from "vitest";
import { runReport } from "./report.js";

it("returns a parsed request for downstream research", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-command-"));
  try {
    const request = await runReport(
      "Read https://example.com/a",
      pino({ level: "silent" }),
      join(directory, "urls.txt"),
    );
    expect(request).toMatchObject({
      requestedUrls: [{ url: "https://example.com/a" }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects a missing research instruction", async () => {
  await expect(runReport("  ", pino({ level: "silent" }))).rejects.toThrow();
});
