import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("emits JSON with the sole appName binding, ISO timestamp and configured level", () => {
  const bytes = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import {createLogger} from './src/logger.ts';const logger=createLogger({appName:'test-app'});logger.info('hidden');logger.warn({err:new Error('safe')},'Operate failed.');",
    ],
    { env: { ...process.env, LOG_LEVEL: "warn" }, encoding: "utf8" },
  );
  const rows = bytes.trim().split("\n");
  expect(rows).toHaveLength(1);
  const record = JSON.parse(rows[0] ?? "");
  expect(record).toMatchObject({
    appName: "test-app",
    level: 40,
    msg: "Operate failed.",
    err: { message: "safe" },
  });
  expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(record.pid).toBeUndefined();
  expect(record.hostname).toBeUndefined();
  expect(bytes).not.toContain("hidden");
});
it("terminates on unhandled rejection without logging backend bytes", () => {
  const processResult = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import {createLogger,installGlobalErrorHandlers} from './src/logger.ts';installGlobalErrorHandlers(createLogger({appName:'test-app'}));Promise.reject(Object.assign(new Error('synthetic-private-bytes'),{code:'ENOSPC',syscall:'write',cause:Object.assign(new Error('synthetic-cause-bytes'),{code:'EPERM',syscall:'chown'})}));",
    ],
    { env: { ...process.env, LOG_LEVEL: "info" }, encoding: "utf8" },
  );
  expect(processResult.status).toBe(1);
  expect(processResult.stdout.trim()).not.toBe("");
  expect(JSON.parse(processResult.stdout)).toMatchObject({
    appName: "test-app",
    msg: "Unhandled rejection.",
    err: {
      message: "Unexpected process failure",
      cause: {
        category: "filesystem",
        code: "ENOSPC",
        syscall: "write",
        cause: { code: "EPERM", syscall: "chown" },
      },
    },
  });
  expect(processResult.stdout).not.toContain("synthetic-cause-bytes");
  expect(processResult.stdout + processResult.stderr).not.toContain(
    "synthetic-private-bytes",
  );
});
