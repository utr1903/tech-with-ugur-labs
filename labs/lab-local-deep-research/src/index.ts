import { Command } from "commander";
import { runSearch } from "./commands/search.js";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the ambient environment
}

const logger = createLogger({ appName: "local-deep-research" });
installGlobalErrorHandlers(logger);
const config = loadConfig(process.env);

const program = new Command();
program
  .name("local-deep-research")
  .description("Deep research on your own laptop: local model, cited reports.");

program
  .command("search")
  .description("Research a question and write research/<topic>/report.md")
  .argument("<question>", "the question to research")
  .action(async (question: string) => {
    await runSearch({ question, config, logger });
  });

await program.parseAsync();
