import { parseArgs } from "node:util";
import { runPostAllowlist } from "./commands/post-allowlist";
import { runPreAllowlist } from "./commands/pre-allowlist";
import { parseConfig } from "./config/config";
import { createLogger, installGlobalErrorHandlers } from "./logger";
import { summarize } from "./proofs/result";

const logger = createLogger({ appName: "shared-vpc-verifier" });
installGlobalErrorHandlers(logger);

const { values } = parseArgs({
	options: {
		phase: { type: "string" },
		config: { type: "string" },
	},
});

if (values.phase !== "pre-allowlist" && values.phase !== "post-allowlist") {
	logger.error({ phase: values.phase }, "Parsing arguments failed.");
	process.exit(2);
}
if (!values.config) {
	logger.error({}, "Parsing arguments failed: --config <path> is required.");
	process.exit(2);
}

const config = parseConfig(await Bun.file(values.config).text());
const runPhase =
	values.phase === "pre-allowlist" ? runPreAllowlist : runPostAllowlist;

logger.info({ phase: values.phase }, "Running verification phase...");
const results = await runPhase({ config, logger });
const summary = summarize(results);
logger.info(
	{ phase: values.phase, results, ...summary },
	"Running verification phase finished.",
);
process.exit(summary.exitCode);
