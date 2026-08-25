import type pg from "pg";
import type { DrillConfig } from "../config.js";
import {
  computeTableChecksums,
  diffChecksums,
  type TableChecksums,
} from "../db/checksums.js";
import { connectDb, connectDbWithRetry } from "../db/client.js";
import {
  createOnDemandBackup,
  createSqlAdminClient,
  restoreFromBackup,
  type SqlAdminDeps,
  waitForInstanceRunnable,
} from "../gcp/sqlAdmin.js";
import type { Logger } from "../logger.js";
import { applyFaultyMigration } from "./faultyMigration.js";
import { checkInvariants, type InvariantResult } from "./invariantCheck.js";
import { seedDatabase } from "./seed.js";
import { generateOrders } from "./seedData.js";

const TABLES = ["orders", "control_totals"] as const;
const ORDER_COUNT = 500;
const INSTANCE_RUNNABLE_TIMEOUT_MS = 10 * 60 * 1000;

type DbClient = Pick<pg.Client, "end">;

export type DrillStages = {
  connect: () => Promise<DbClient>;
  connectWithRetry: () => Promise<DbClient>;
  seed: (client: DbClient) => Promise<void>;
  checksums: (client: DbClient) => Promise<TableChecksums>;
  backup: () => Promise<string>;
  migrate: (client: DbClient) => Promise<void>;
  invariants: (client: DbClient) => Promise<InvariantResult>;
  restore: (backupRunId: string) => Promise<void>;
};

export type DrillSummary = {
  backupRunId: string;
  corruptedRows: number;
  grandTotalDriftCents: number;
  tablesVerified: string[];
};

function realStages(config: DrillConfig, logger: Logger): DrillStages {
  const deps: SqlAdminDeps = {
    sql: createSqlAdminClient(),
    project: config.projectId,
    instance: config.instanceName,
    logger: logger.child({ domain: "sqladmin" }),
  };
  return {
    connect: () => connectDb(config, logger),
    connectWithRetry: () => connectDbWithRetry(config, logger),
    seed: (client) =>
      seedDatabase(client as pg.Client, generateOrders(ORDER_COUNT), logger),
    checksums: (client) =>
      computeTableChecksums(client as pg.Client, TABLES, logger),
    backup: () => createOnDemandBackup(deps),
    migrate: (client) => applyFaultyMigration(client as pg.Client, logger),
    invariants: (client) => checkInvariants(client as pg.Client, logger),
    restore: async (backupRunId) => {
      await restoreFromBackup(deps, backupRunId);
      await waitForInstanceRunnable(deps, INSTANCE_RUNNABLE_TIMEOUT_MS);
    },
  };
}

export async function runDrill(
  config: DrillConfig,
  logger: Logger,
  overrides?: Partial<DrillStages>,
): Promise<DrillSummary> {
  const stages = { ...realStages(config, logger), ...overrides };

  // Stage 1: seed a known-good dataset.
  const client = await stages.connect();
  await stages.seed(client);

  // Stage 2: record ground truth, then take the pre-migration backup.
  const baseline = await stages.checksums(client);
  const backupRunId = await stages.backup();

  // Stage 3: the risky migration ships — and silently corrupts data.
  await stages.migrate(client);
  const postCorruption = await stages.checksums(client);

  // Stage 4: detect. The runner, not a human, decides what happens next.
  const invariant = await stages.invariants(client);
  if (invariant.holds) {
    throw new Error(
      "Invariant unexpectedly holds after the faulty migration; nothing to recover from, aborting the drill",
    );
  }
  if (diffChecksums(baseline, postCorruption).length === 0) {
    throw new Error(
      "Checksums did not change after the faulty migration; corruption evidence is missing",
    );
  }

  // Stage 5: recover. The restore replaces the whole instance state,
  // killing our connection — reconnect from scratch afterwards.
  logger.warn(
    { corruptedRows: invariant.corruptedRows, backupRunId },
    "Invariant violated; triggering automatic restore...",
  );
  await client.end();
  await stages.restore(backupRunId);
  const restoredClient = await stages.connectWithRetry();

  // Stage 6: prove. A restore you have not verified is a hope, not a
  // recovery.
  try {
    const restored = await stages.checksums(restoredClient);
    const mismatches = diffChecksums(baseline, restored);
    if (mismatches.length > 0) {
      throw new Error(
        `Restored checksums differ from the pre-migration baseline for: ${mismatches.join(", ")}`,
      );
    }
    return {
      backupRunId,
      corruptedRows: invariant.corruptedRows,
      grandTotalDriftCents: invariant.grandTotalDriftCents,
      tablesVerified: [...TABLES].sort(),
    };
  } finally {
    await restoredClient.end();
  }
}
