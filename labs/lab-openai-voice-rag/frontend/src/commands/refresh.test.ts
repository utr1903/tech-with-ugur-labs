import pino from "pino";
import { expect, test, vi } from "vitest";
import { refresh } from "./refresh";

const logger = pino({ enabled: false });
test("refresh POSTs the ingestion endpoint and returns its counts", async () => {
	const request = vi.fn(async () =>
		Response.json({ added: 1, changed: 2, deleted: 0, unchanged: 4 }),
	);
	expect(await refresh("http://backend:3001", logger, request)).toEqual({
		added: 1,
		changed: 2,
		deleted: 0,
		unchanged: 4,
	});
	expect(request).toHaveBeenCalledWith(
		"http://backend:3001/api/ingest",
		expect.objectContaining({ method: "POST" }),
	);
});
test("failed refresh propagates a safe error", async () => {
	await expect(
		refresh(
			"http://backend:3001",
			logger,
			async () => new Response("private provider detail", { status: 503 }),
		),
	).rejects.toThrow("Corpus refresh failed");
});
