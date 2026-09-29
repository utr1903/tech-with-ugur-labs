export function extractReport(
	message: { type: string; content: unknown } | undefined,
): string {
	if (message?.type !== "ai")
		throw new Error("Agent returned no assistant report");
	const content = message.content;
	const report =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.filter(
							(block) =>
								block?.type === "text" && typeof block.text === "string",
						)
						.map((block) => block.text)
						.join("\n")
				: "";
	if (!report.trim()) throw new Error("Agent returned no report text");
	return report;
}
