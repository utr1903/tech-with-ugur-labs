import { describe, expect, it, vi } from "vitest";
import type { DrillConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { type DrillStages, runDrill } from "./runDrill.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
} as unknown as Logger;

const config: DrillConfig = {
  projectId: "my-project",
  instanceName: "postgres-dr-drill-abc123",
  dbHost: "203.0.113.10",
  dbPort: 5432,
  dbName: "shop",
  dbUser: "drill",
  dbPassword: "secret",
};

const fakeClient = { end: vi.fn().mockResolvedValue(undefined) };

function happyStages(): DrillStages {
  const checksums = vi
    .fn()
    .mockResolvedValueOnce({ orders: "base", control_totals: "ctl" })
    .mockResolvedValueOnce({ orders: "corrupt", control_totals: "ctl" })
    .mockResolvedValueOnce({ orders: "base", control_totals: "ctl" });
  return {
    connect: vi.fn().mockResolvedValue(fakeClient),
    connectWithRetry: vi.fn().mockResolvedValue(fakeClient),
    seed: vi.fn().mockResolvedValue(undefined),
    checksums,
    backup: vi.fn().mockResolvedValue("12345"),
    migrate: vi.fn().mockResolvedValue(undefined),
    invariants: vi.fn().mockResolvedValue({
      corruptedRows: 412,
      grandTotalDriftCents: 61_000,
      holds: false,
    }),
    restore: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runDrill", () => {
  it("runs detect -> restore -> verify and reports the proof", async () => {
    const stages = happyStages();
    const summary = await runDrill(config, silentLogger, stages);
    expect(stages.restore).toHaveBeenCalledWith("12345");
    expect(summary).toEqual({
      backupRunId: "12345",
      corruptedRows: 412,
      grandTotalDriftCents: 61_000,
      tablesVerified: ["control_totals", "orders"],
    });
  });

  it("aborts without restoring when the migration fails to corrupt", async () => {
    const stages = happyStages();
    stages.invariants = vi.fn().mockResolvedValue({
      corruptedRows: 0,
      grandTotalDriftCents: 0,
      holds: true,
    });
    await expect(runDrill(config, silentLogger, stages)).rejects.toThrow(
      "unexpectedly holds",
    );
    expect(stages.restore).not.toHaveBeenCalled();
  });

  it("fails when the restored checksums differ from the baseline", async () => {
    const stages = happyStages();
    stages.checksums = vi
      .fn()
      .mockResolvedValueOnce({ orders: "base", control_totals: "ctl" })
      .mockResolvedValueOnce({ orders: "corrupt", control_totals: "ctl" })
      .mockResolvedValueOnce({
        orders: "STILL-CORRUPT",
        control_totals: "ctl",
      });
    await expect(runDrill(config, silentLogger, stages)).rejects.toThrow(
      "differ",
    );
  });

  it("fails when the corrupted state did not differ from the baseline", async () => {
    const stages = happyStages();
    stages.checksums = vi
      .fn()
      .mockResolvedValue({ orders: "base", control_totals: "ctl" });
    stages.invariants = vi.fn().mockResolvedValue({
      corruptedRows: 1,
      grandTotalDriftCents: 0,
      holds: false,
    });
    await expect(runDrill(config, silentLogger, stages)).rejects.toThrow(
      "did not change",
    );
  });
});
