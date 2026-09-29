import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import type { Logger } from "pino";
import { discoverInputs } from "../input/discover.js";
import { appendCoverage, createCoverage } from "../report/coverage.js";
import { validateReport } from "../report/validate.js";
import { draftReport } from "../research/agent.js";
import type { AgentInput, AgentOutput } from "../research/types.js";

export interface ReportOptions {
	workspaceDir: string;
	apiKey?: string;
	model?: string;
	searchModel?: string;
	logger: Logger;
	draft?: (input: AgentInput) => Promise<AgentOutput>;
}

export async function runReport(
	instruction: string,
	options: ReportOptions,
): Promise<void> {
	const { logger, workspaceDir } = options;
	logger.info({ workspaceDir }, "Running report...");
	try {
		if (!instruction.trim())
			throw new Error("A report instruction is required.");
		if (!options.apiKey?.trim()) throw new Error("OPENAI_API_KEY is required.");
		const { requestedUrls, notes } = await discoverInputs(
			instruction,
			join(workspaceDir, "input"),
		);
		const output = await (options.draft ?? draftReport)({
			instruction,
			requestedUrls,
			notes,
			workspaceDir,
			model: options.model ?? "gpt-6-sol",
			...(options.searchModel ? { searchModel: options.searchModel } : {}),
			client: new OpenAI({ apiKey: options.apiKey }),
			logger,
		});
		const manifest = createCoverage(
			output.results,
			output.supplemental,
			output.events,
		);
		const report = appendCoverage(output.report, manifest);
		const failures = validateReport(report, instruction, manifest);
		if (!output.report.trim()) failures.push("Report is empty.");
		if (manifest.failedCount > 0)
			failures.push(`${manifest.failedCount} failed requested URL(s).`);
		if (failures.length > 0) manifest.status = "partial";
		const outputDir = join(workspaceDir, "output");
		await mkdir(outputDir, { recursive: true });
		await Promise.all([
			writeFile(join(outputDir, "report.md"), report),
			writeFile(
				join(outputDir, "coverage.json"),
				`${JSON.stringify(manifest, null, 2)}\n`,
			),
		]);
		if (failures.length > 0) throw new Error(failures.join(" "));
		logger.info(
			{ requestedCount: manifest.requestedCount, outputDir },
			"Running report succeeded.",
		);
	} catch (err) {
		logger.error({ err, workspaceDir }, "Running report failed.");
		throw err;
	}
}
