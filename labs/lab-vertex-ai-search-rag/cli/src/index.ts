import { resolve } from "node:path";
import { Command } from "commander";
import { runAsk } from "./commands/ask.js";
import { runUpload } from "./commands/upload.js";
import { loadConfig } from "./config/config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "vertex-ai-search-rag" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env, resolve(import.meta.dirname, "config"));

const program = new Command();
program
  .name("vertex-ai-search-rag")
  .description(
    "Upload a corpus to Vertex AI Search, ask it questions, and prove the answers came from retrieval.",
  );

program
  .command("upload")
  .description("Upload the corpus to Cloud Storage and import it into the data store.")
  .action(async () => {
    await runUpload(config, logger);
  });

program
  .command("ask")
  .argument("<question>", "the question to ask the corpus")
  .option("--raw", "also print the retrieved chunks the answer was built from", false)
  .description("Ask the search app a question and show its answer, citations and grounding.")
  .action(async (question: string, options: { raw: boolean }) => {
    await runAsk(config, question, options, logger);
  });

await program.parseAsync(process.argv);
