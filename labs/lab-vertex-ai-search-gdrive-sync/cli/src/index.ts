import { resolve } from "node:path";
import { Command } from "commander";
import { runSeed } from "./commands/seed.js";
import { runSync } from "./commands/sync.js";
import { loadConfig } from "./config/config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "gdrive-sync" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env, resolve(import.meta.dirname, ".."));

const program = new Command();
program
  .name("gdrive-sync")
  .description("Sync a Google Drive folder into Vertex AI Search and prove the index keeps up.");

program
  .command("seed")
  .description("Create the corpus folders and Google Docs in the shared drive.")
  .action(async () => {
    await runSeed(config, logger);
  });

program
  .command("sync")
  .description("Walk the Drive folder, export the Docs, and import them into the data store.")
  .option("--incremental", "upsert by id instead of rebasing the whole data store", false)
  .action(async (options: { incremental: boolean }) => {
    await runSync(config, { mode: options.incremental ? "INCREMENTAL" : "FULL" }, logger);
  });

await program.parseAsync(process.argv);
