import { branchPath, type LabConfig, servingConfigPath } from "../config/config.js";
import { DRIVE_WRITE_SCOPE, docsClient, driveClient } from "../drive/auth.js";
import { readManifest } from "../drive/manifest.js";
import type { Logger } from "../logger.js";
import { conversationalClient, documentClient } from "../search/clients.js";
import { summarize } from "../verify/checks.js";
import { verifyBaseline, verifyFreshness, verifyMove } from "../verify/stages.js";
import { writeLine } from "./output.js";
import { resolveFixture, runSync } from "./sync.js";

export async function runVerify(config: LabConfig, logger: Logger): Promise<number> {
  const manifest = await readManifest(config.statePath);
  if (manifest === null) {
    throw new Error("No sync manifest found. Run npm run sync before npm run verify.");
  }

  // The mutation stages need write scope; the sync path inside `resync` keeps
  // its own read-only credentials.
  const drive = await driveClient(config, [DRIVE_WRITE_SCOPE]);
  const { corpusId, archiveId } = await resolveFixture(drive, config, logger);

  const context = {
    config,
    drive,
    docs: await docsClient(config),
    documents: documentClient(config),
    conversational: conversationalClient(config),
    servingConfig: servingConfigPath(config),
    branch: branchPath(config),
    manifest,
    corpusId,
    archiveId,
    resync: async (mode: "FULL" | "INCREMENTAL") => {
      await runSync(config, { mode }, logger);
      const next = await readManifest(config.statePath);
      if (next === null) {
        throw new Error("Sync did not write a manifest.");
      }
      return next;
    },
    logger,
  };

  const checks = [
    ...(await verifyBaseline(context)),
    ...(await verifyFreshness({ ...context, manifest })),
    ...(await verifyMove({ ...context, manifest })),
  ];

  for (const check of checks) {
    writeLine(`${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
  }

  const summary = summarize(checks);
  writeLine("");
  writeLine(`${summary.total - summary.failed}/${summary.total} checks passed.`);
  return summary.ok ? 0 : 1;
}
