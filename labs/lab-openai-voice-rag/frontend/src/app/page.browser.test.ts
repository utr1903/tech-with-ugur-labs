import { expect, test } from "@playwright/test";

test.skip(
	process.env.RUN_LIVE_CANARY === "1",
	"Scripted assertions are separate from the live canary.",
);
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const tracks: MediaStreamTrack[] = [];
		const original = navigator.mediaDevices.getUserMedia.bind(
			navigator.mediaDevices,
		);
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			const stream = await original(constraints);
			tracks.push(...stream.getTracks());
			return stream;
		};
		Object.defineProperty(window, "acquiredTracks", { value: tracks });
	});
});
async function ended(page: import("@playwright/test").Page) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const tracks = (
					window as unknown as { acquiredTracks: MediaStreamTrack[] }
				).acquiredTracks;
				return (
					tracks.length > 0 && tracks.every((t) => t.readyState === "ended")
				);
			}),
		)
		.toBe(true);
}
test("readiness, real ingestion, simulated relay, sources and two microphone sessions", async ({
	page,
	request,
}) => {
	expect((await request.get("/api/ready")).ok()).toBe(true);
	expect((await request.post("/api/ingest")).ok()).toBe(true);
	const ids: string[] = [];
	page.on("response", async (response) => {
		if (response.url().endsWith("/api/realtime/token") && response.ok())
			ids.push((await response.json()).conversationId);
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	await expect(
		page.getByText("Simulated transport — no live inference or speech.", {
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByLabel("Simulated question")
		.fill("What is the amber valve recovery code?");
	await page.getByRole("button", { name: "Ask", exact: true }).click();
	await expect(page.getByRole("region", { name: "Answer" })).toContainText(
		"ORCHID-47",
	);
	await expect(page.getByRole("region", { name: "Answer" })).toContainText(
		"handbook.md",
	);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await ended(page);
	await expect(page.getByRole("region", { name: "Answer" })).toHaveCount(0);
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	await expect.poll(() => ids.length).toBe(2);
	expect(ids[0]).not.toBe(ids[1]);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await ended(page);
});
test("token and relay failures show safe retryable errors", async ({
	page,
}) => {
	await page.route("**/api/realtime/token", (route) =>
		route.fulfill({ status: 503, json: { error: "private provider detail" } }),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Start again",
	);
	await expect(page.getByRole("main").getByRole("alert")).not.toContainText(
		"private",
	);
	await page.unroute("**/api/realtime/token");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	await page.route("**/api/agent", (route) =>
		route.fulfill({ status: 503, json: { error: "private detail" } }),
	);
	await page.getByLabel("Simulated question").fill("canary?");
	await page.getByRole("button", { name: "Ask", exact: true }).click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"Knowledge request failed. Try another question.",
	);
	await page.unroute("**/api/agent");
	await page.getByRole("button", { name: "Ask", exact: true }).click();
	await expect(page.getByRole("region", { name: "Answer" })).toBeVisible();
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await ended(page);
});
test("late answer after Stop cannot enter a fresh session", async ({
	page,
}) => {
	let release!: () => void;
	const hold = new Promise<void>((r) => {
		release = r;
	});
	let received!: () => void;
	const incoming = new Promise<void>((r) => {
		received = r;
	});
	let delivered!: () => void;
	const completed = new Promise<void>((r) => {
		delivered = r;
	});
	await page.route("**/api/agent", async (route) => {
		received();
		await hold;
		await route
			.fulfill({ json: { answer: "STALE ANSWER", sources: [] } })
			.catch(() => {});
		delivered();
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	await page.getByLabel("Simulated question").fill("canary?");
	await page.getByRole("button", { name: "Ask", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Retrieving");
	await incoming;
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await ended(page);
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	release();
	await completed;
	await expect(page.getByRole("region", { name: "Answer" })).toHaveCount(0);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await ended(page);
});
