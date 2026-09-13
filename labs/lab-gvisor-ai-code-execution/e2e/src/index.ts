import { configure, stopForward } from "./lib/application.js";
import { initialize, save } from "./lib/commands.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { admission } from "./probes/admission.js";
import { concurrency } from "./probes/concurrency.js";
import { context } from "./probes/context.js";
import { filesystem } from "./probes/filesystem.js";
import { graph } from "./probes/graph.js";
import { graphResources } from "./probes/graph-resources.js";
import { network } from "./probes/network.js";
import { persistence } from "./probes/persistence.js";
import type { Assertion } from "./probes/report.js";
import { resources } from "./probes/resources.js";
import { runtime } from "./probes/runtime.js";

const logger = createLogger({ appName: "contained-python-e2e" });
installGlobalErrorHandlers(logger);
initialize();
const results: Assertion[] = [];
const reportName = process.argv[2]
	? `report-${process.argv[2]}.json`
	: "report.json";
const probes = {
	context,
	graphResources,
	concurrency,
	runtime,
	admission,
	filesystem,
	resources,
	network,
	graph,
	persistence,
};
try {
	for (const [name, probe] of Object.entries(probes)) {
		if (process.argv[2] && process.argv[2] !== name) continue;
		logger.info({ probe: name }, "Verifying containment...");
		results.push(...(await probe()));
		save(reportName, results);
		logger.info({ probe: name }, "Collecting containment verdicts completed.");
	}
	results.push({
		name: "live-openai",
		layer: "OpenAI provider",
		attempted: "owner-run live code_executor smoke",
		status: "waived",
		evidence: "No API key available; only live-provider verification waived.",
	});
	save(reportName, results);
	if (results.some((r) => r.status === "unverified" || r.status === "failed"))
		process.exitCode = 1;
} catch (err) {
	logger.error({ err }, "Verifying containment failed.");
	results.push({
		name: "suite",
		layer: "orchestration",
		attempted: "complete verification",
		status: "failed",
		evidence: String(err),
	});
	save(reportName, results);
	process.exitCode = 1;
} finally {
	if (
		!process.argv[2] ||
		[
			"graph",
			"graphResources",
			"persistence",
			"concurrency",
			"context",
		].includes(process.argv[2])
	)
		await configure("tool");
	stopForward();
}
