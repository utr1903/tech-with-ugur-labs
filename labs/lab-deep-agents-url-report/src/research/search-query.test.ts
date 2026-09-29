import { expect, it } from "vitest";
import { searchQuery } from "./search-query.js";

it.each([
	"Only use supplied sources and summarize latest findings.",
	"Limit the report to the provided sources and include latest guidance.",
	"Restrict research to these sources and summarize the latest findings.",
])("honors source-only limits: %s", (instruction) => {
	expect(searchQuery(instruction, [])).toBeUndefined();
});
it("bounds total topic evidence and does not use text from failed retrievals", () => {
	const results = Array.from({ length: 12 }, (_, i) => ({
		requestedUrl: `https://example.org/${i}`,
		status: "ok" as const,
		text: `Database replication. ${"x".repeat(20000)}`,
	}));
	const query = searchQuery("Summarize the latest findings.", [
		{
			requestedUrl: "https://example.org/failed",
			status: "failed",
			text: "FAILED_SOURCE_TEXT",
		},
		...results,
	]);
	expect(query).toContain("Database replication");
	expect(query).toContain('"omittedSources":3');
	expect(query).not.toContain("FAILED_SOURCE_TEXT");
	expect(query?.length).toBeLessThan(12000);
});
