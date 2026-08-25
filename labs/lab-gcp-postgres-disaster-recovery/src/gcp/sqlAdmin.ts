import { google, type sqladmin_v1 } from "googleapis";
import type { Logger } from "../logger.js";

export type SqlAdminDeps = {
  sql: sqladmin_v1.Sqladmin;
  project: string;
  instance: string;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_POLL_INTERVAL_MS = 10_000;

// Uses Application Default Credentials: the reader ran
// `gcloud auth application-default login` (see README prerequisites).
export function createSqlAdminClient(): sqladmin_v1.Sqladmin {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/sqlservice.admin"],
  });
  return google.sqladmin({ version: "v1", auth });
}

// Cloud SQL Admin API calls (backup, restore) return long-running
// operations; the only way to know they finished is to poll.
export async function waitForOperation(
  deps: SqlAdminDeps,
  operationName: string,
  timeoutMs: number,
): Promise<void> {
  const { sql, project, logger } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  try {
    logger.info({ operationName, timeoutMs }, "Waiting for operation...");
    let waitedMs = 0;
    for (;;) {
      const { data } = await sql.operations.get({
        project,
        operation: operationName,
      });
      if (data.status === "DONE") {
        if (data.error?.errors?.length) {
          throw new Error(
            `Operation ${operationName} failed: ${JSON.stringify(data.error.errors)}`,
          );
        }
        logger.info(
          { operationName, waitedMs },
          "Waiting for operation succeeded.",
        );
        return;
      }
      if (waitedMs >= timeoutMs) {
        throw new Error(
          `Timed out after ${waitedMs}ms waiting for operation ${operationName} (last status: ${data.status})`,
        );
      }
      await sleep(pollIntervalMs);
      waitedMs += pollIntervalMs;
    }
  } catch (err) {
    logger.error({ err, operationName }, "Waiting for operation failed.");
    throw err;
  }
}

const BACKUP_TIMEOUT_MS = 20 * 60 * 1000;
const RESTORE_TIMEOUT_MS = 30 * 60 * 1000;

export async function createOnDemandBackup(
  deps: SqlAdminDeps,
): Promise<string> {
  const { sql, project, instance, logger } = deps;
  try {
    logger.info({ project, instance }, "Creating on-demand backup...");
    const { data: operation } = await sql.backupRuns.insert({
      project,
      instance,
      requestBody: { description: "pre-migration drill backup" },
    });
    if (!operation.name) {
      throw new Error("Backup insert returned an operation without a name");
    }
    await waitForOperation(deps, operation.name, BACKUP_TIMEOUT_MS);
    const backupRunId =
      operation.backupContext?.backupId ?? (await findLatestBackupRunId(deps));
    const { data: run } = await sql.backupRuns.get({
      project,
      instance,
      id: backupRunId,
    });
    if (run.status !== "SUCCESSFUL") {
      throw new Error(
        `Backup run ${backupRunId} finished with status ${run.status}`,
      );
    }
    logger.info({ backupRunId }, "Creating on-demand backup succeeded.");
    return backupRunId;
  } catch (err) {
    logger.error(
      { err, project, instance },
      "Creating on-demand backup failed.",
    );
    throw err;
  }
}

async function findLatestBackupRunId(deps: SqlAdminDeps): Promise<string> {
  const { sql, project, instance } = deps;
  const { data } = await sql.backupRuns.list({
    project,
    instance,
    maxResults: 5,
  });
  const successful = data.items?.find((run) => run.status === "SUCCESSFUL");
  if (!successful?.id) {
    throw new Error("No SUCCESSFUL backup run found after backup operation");
  }
  return String(successful.id);
}

export async function restoreFromBackup(
  deps: SqlAdminDeps,
  backupRunId: string,
): Promise<void> {
  const { sql, project, instance, logger } = deps;
  try {
    logger.info({ backupRunId }, "Restoring instance from backup...");
    const { data: operation } = await sql.instances.restoreBackup({
      project,
      instance,
      requestBody: { restoreBackupContext: { backupRunId } },
    });
    if (!operation.name) {
      throw new Error("Restore returned an operation without a name");
    }
    await waitForOperation(deps, operation.name, RESTORE_TIMEOUT_MS);
    logger.info({ backupRunId }, "Restoring instance from backup succeeded.");
  } catch (err) {
    logger.error(
      { err, backupRunId },
      "Restoring instance from backup failed.",
    );
    throw err;
  }
}

export async function waitForInstanceRunnable(
  deps: SqlAdminDeps,
  timeoutMs: number,
): Promise<void> {
  const { sql, project, instance, logger } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  try {
    logger.info(
      { instance, timeoutMs },
      "Waiting for instance to be RUNNABLE...",
    );
    let waitedMs = 0;
    for (;;) {
      const { data } = await sql.instances.get({ project, instance });
      if (data.state === "RUNNABLE") {
        logger.info(
          { instance, waitedMs },
          "Waiting for instance to be RUNNABLE succeeded.",
        );
        return;
      }
      if (waitedMs >= timeoutMs) {
        throw new Error(
          `Timed out after ${waitedMs}ms waiting for instance ${instance} (last state: ${data.state})`,
        );
      }
      await sleep(pollIntervalMs);
      waitedMs += pollIntervalMs;
    }
  } catch (err) {
    logger.error(
      { err, instance },
      "Waiting for instance to be RUNNABLE failed.",
    );
    throw err;
  }
}
