import type { sqladmin_v1 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import {
  createOnDemandBackup,
  restoreFromBackup,
  type SqlAdminDeps,
  waitForInstanceRunnable,
  waitForOperation,
} from "./sqlAdmin.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function makeDeps(sql: unknown): SqlAdminDeps {
  return {
    sql: sql as sqladmin_v1.Sqladmin,
    project: "my-project",
    instance: "postgres-dr-drill-abc123",
    logger: silentLogger,
    sleep: () => Promise.resolve(),
    pollIntervalMs: 1,
  };
}

describe("waitForOperation", () => {
  it("polls until the operation is DONE", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "RUNNING" } })
      .mockResolvedValueOnce({ data: { status: "RUNNING" } })
      .mockResolvedValueOnce({ data: { status: "DONE" } });
    await waitForOperation(makeDeps({ operations: { get } }), "op-1", 60_000);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith({
      project: "my-project",
      operation: "op-1",
    });
  });

  it("throws when the finished operation carries errors", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        status: "DONE",
        error: { errors: [{ code: "INTERNAL", message: "boom" }] },
      },
    });
    await expect(
      waitForOperation(makeDeps({ operations: { get } }), "op-1", 60_000),
    ).rejects.toThrow("op-1");
  });

  it("throws when the timeout elapses before DONE", async () => {
    const get = vi.fn().mockResolvedValue({ data: { status: "RUNNING" } });
    const deps = { ...makeDeps({ operations: { get } }), pollIntervalMs: 50 };
    await expect(waitForOperation(deps, "op-1", 100)).rejects.toThrow(
      "Timed out",
    );
  });
});

describe("createOnDemandBackup", () => {
  it("inserts a backup run, waits, and returns the SUCCESSFUL run id", async () => {
    const insert = vi.fn().mockResolvedValue({
      data: { name: "op-backup", backupContext: { backupId: "12345" } },
    });
    const operationsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "DONE" } });
    const backupRunsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "SUCCESSFUL" } });
    const sql = {
      backupRuns: { insert, get: backupRunsGet },
      operations: { get: operationsGet },
    };
    const backupRunId = await createOnDemandBackup(makeDeps(sql));
    expect(backupRunId).toBe("12345");
    expect(backupRunsGet).toHaveBeenCalledWith({
      project: "my-project",
      instance: "postgres-dr-drill-abc123",
      id: "12345",
    });
  });

  it("falls back to listing backup runs when the operation has no backup context", async () => {
    const insert = vi.fn().mockResolvedValue({ data: { name: "op-backup" } });
    const operationsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "DONE" } });
    const list = vi.fn().mockResolvedValue({
      data: { items: [{ id: "777", status: "SUCCESSFUL" }] },
    });
    const backupRunsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "SUCCESSFUL" } });
    const sql = {
      backupRuns: { insert, list, get: backupRunsGet },
      operations: { get: operationsGet },
    };
    expect(await createOnDemandBackup(makeDeps(sql))).toBe("777");
  });

  it("throws when the finished backup run is not SUCCESSFUL", async () => {
    const insert = vi.fn().mockResolvedValue({
      data: { name: "op-backup", backupContext: { backupId: "12345" } },
    });
    const operationsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "DONE" } });
    const backupRunsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "FAILED" } });
    const sql = {
      backupRuns: { insert, get: backupRunsGet },
      operations: { get: operationsGet },
    };
    await expect(createOnDemandBackup(makeDeps(sql))).rejects.toThrow("FAILED");
  });
});

describe("restoreFromBackup", () => {
  it("issues the in-place restore and waits for the operation", async () => {
    const restoreBackup = vi
      .fn()
      .mockResolvedValue({ data: { name: "op-restore" } });
    const operationsGet = vi
      .fn()
      .mockResolvedValue({ data: { status: "DONE" } });
    const sql = {
      instances: { restoreBackup },
      operations: { get: operationsGet },
    };
    await restoreFromBackup(makeDeps(sql), "12345");
    expect(restoreBackup).toHaveBeenCalledWith({
      project: "my-project",
      instance: "postgres-dr-drill-abc123",
      requestBody: { restoreBackupContext: { backupRunId: "12345" } },
    });
  });
});

describe("waitForInstanceRunnable", () => {
  it("polls until the instance reports RUNNABLE", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { state: "MAINTENANCE" } })
      .mockResolvedValueOnce({ data: { state: "RUNNABLE" } });
    await waitForInstanceRunnable(makeDeps({ instances: { get } }), 60_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("throws when the timeout elapses first", async () => {
    const get = vi.fn().mockResolvedValue({ data: { state: "MAINTENANCE" } });
    const deps = { ...makeDeps({ instances: { get } }), pollIntervalMs: 50 };
    await expect(waitForInstanceRunnable(deps, 100)).rejects.toThrow(
      "Timed out",
    );
  });
});
