import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logger.js";

const SCENARIO_NAME = /^s[0-9]-[a-z0-9-]+$/;

export function isValidScenario(name: string): boolean {
  return SCENARIO_NAME.test(name);
}

export function renderStage(template: string, attackerIp: string): string {
  return template.replaceAll("__ATTACKER__", attackerIp);
}

/** Returns the rendered stage script, or null when the scenario is unknown. */
export async function loadStage(
  logger: Logger,
  scenariosDir: string,
  scenario: string,
  attackerIp: string,
): Promise<string | null> {
  if (!isValidScenario(scenario)) {
    logger.warn(
      { scenario },
      "Loading stage rejected an invalid scenario name.",
    );
    return null;
  }
  try {
    logger.info({ scenario }, "Loading stage...");
    const template = await readFile(
      join(scenariosDir, scenario, "stage.sh"),
      "utf8",
    );
    logger.info({ scenario }, "Loading stage succeeded.");
    return renderStage(template, attackerIp);
  } catch (err) {
    logger.warn({ err, scenario }, "Loading stage found no stage script.");
    return null;
  }
}
