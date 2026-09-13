import assert from "node:assert/strict";
import type { Page, Request } from "playwright";
import { configure, request, startForward } from "../lib/application.js";
import { json, pause, save } from "../lib/commands.js";
import { crashBackend } from "../lib/crash-backend.js";
import { watchJobs } from "../lib/job-watch.js";
import { executedMarker } from "../lib/running-marker.js";
export async function browserCrash(page: Page) {
	await configure(
		"tool",
		"import time;print('EXECUTED',flush=True);time.sleep(8);print(42)",
	);
	const previous = await page.evaluate(() =>
		localStorage.getItem("contained-chat:selected"),
	);
	await page
		.getByRole("button", { name: "New conversation", exact: true })
		.click();
	await page.waitForFunction(
		(prior) => localStorage.getItem("contained-chat:selected") !== prior,
		previous,
	);
	const requests: string[] = [];
	const capture = (request: Request) => {
		if (request.method() === "POST" && request.url().endsWith("/chat"))
			requests.push(request.postData() ?? "");
	};
	page.on("request", capture);
	const watcher = watchJobs();
	try {
		await page
			.getByRole("textbox")
			.fill("Calculate with Python after saving this turn.");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await page
			.getByText("Running Python…", { exact: false })
			.first()
			.waitFor({ timeout: 30000 });
		const id = await page.evaluate(() =>
			localStorage.getItem("contained-chat:selected"),
		);
		assert(id);
		await executedMarker();
		const jobs = json<{ items: { metadata: { uid: string; name: string } }[] }>(
			["get", "jobs", "-n", "executor"],
		);
		assert(jobs.items.length > 0);
		await crashBackend();
		await startForward();
		await page.reload();
		let history: { activeTurn: unknown; messages: { role: string }[] } = {
			activeTurn: "pending",
			messages: [],
		};
		for (let n = 0; n < 120; n++) {
			history = await (await request(`/threads/${id}/messages`)).json();
			if (history.activeTurn === null) break;
			await pause(500);
		}
		assert.equal(history.activeTurn, null);
		assert.equal(
			history.messages.filter((m: { role: string }) => m.role === "tool")
				.length,
			1,
		);
		assert.equal(
			json<{ items: unknown[] }>(["get", "jobs", "-n", "executor"]).items
				.length,
			0,
		);
		await pause(500);
		const original = jobs.items[0];
		assert(original);
		const tool = history.messages.find((m) => m.role === "tool") as
			| { role: string; text: string }
			| undefined;
		assert(tool);
		assert.equal(
			original.metadata.name,
			`exec-${JSON.parse(tool.text).executionId}`,
		);
		watcher.assertSingle(original.metadata.name, original.metadata.uid);
		assert(
			requests.length >= 2,
			"Active refresh did not resume original request.",
		);
		assert.equal(
			new Set(requests).size,
			1,
			"Refresh changed the original turn identity or request.",
		);
		save("browser-crash.json", { id, jobsBefore: jobs, history, requests });
	} finally {
		page.off("request", capture);
		watcher.stop();
	}
}
