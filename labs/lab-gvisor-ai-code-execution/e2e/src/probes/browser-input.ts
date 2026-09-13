import assert from "node:assert/strict";
import type { Page } from "playwright";
import { save } from "../lib/commands.js";
export async function browserInput(page: Page) {
	const prior = await page.evaluate(() =>
		localStorage.getItem("contained-chat:selected"),
	);
	await page
		.getByRole("button", { name: "New conversation", exact: true })
		.click();
	await page.waitForFunction(
		(prior) => localStorage.getItem("contained-chat:selected") !== prior,
		prior,
	);

	await page.getByRole("textbox").fill("a".repeat(16385));
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page.getByText("Message must contain", { exact: false }).waitFor();
	const id = await page.evaluate(() =>
		localStorage.getItem("contained-chat:selected"),
	);
	assert(id);
	assert.equal(
		await page.evaluate(
			(id) => localStorage.getItem(`contained-chat:pending:${id}`),
			id,
		),
		null,
	);
	await sendValid(page, "Continue after oversized input.");
	assert.equal(
		await page.evaluate(() => localStorage.getItem("contained-chat:selected")),
		id,
	);
	await page.route("**/chat", async (route) => {
		await route.continue({
			postData: JSON.stringify({
				...route.request().postDataJSON(),
				messages: [{ id: "invalid", role: "user", text: "a".repeat(16385) }],
			}),
		});
	});
	await page
		.getByRole("textbox")
		.fill("Optimistic input rejected by the server.");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page
		.getByText("Message rejected before submission", { exact: false })
		.waitFor();
	assert(
		!(await page.locator("main").innerText()).includes(
			"Optimistic input rejected by the server.",
		),
	);
	await page.unroute("**/chat");
	await sendValid(page, "Continue after definitive rejection.");
	await page.evaluate(
		(id) => localStorage.setItem(`contained-chat:pending:${id}`, "{broken"),
		id,
	);
	await page.reload();
	await page.getByText("Saved request unavailable", { exact: false }).waitFor();
	await sendValid(page, "Continue after corrupt storage.");
	await page.evaluate(() => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (key.startsWith("contained-chat:pending:"))
				throw new Error("Quota exceeded");
			original.call(this, key, value);
		};
	});
	await sendValid(page, "Continue with unavailable pending storage.");
	await page
		.getByText("Browser storage unavailable", { exact: false })
		.waitFor();
	save("browser-input.json", {
		thread: id,
		oversizedRecovered: true,
		definitiveRejectionRecovered: true,
		optimisticRejectedRemoved: true,
		corruptStorageRecovered: true,
		unavailableStorageRecovered: true,
	});
	await page.reload();
}
async function sendValid(page: Page, text: string) {
	const response = page.waitForResponse(
		(r) => r.url().endsWith("/chat") && r.request().method() === "POST",
	);
	await page.getByRole("textbox").fill(text);
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await (await response).finished();
	await page
		.getByText("Working…", { exact: true })
		.waitFor({ state: "hidden", timeout: 60000 });
	await page.waitForFunction(
		() =>
			!Object.keys(localStorage).some((k) =>
				k.startsWith("contained-chat:pending:"),
			),
	);
	await page
		.getByText("succeeded", { exact: false })
		.first()
		.waitFor({ timeout: 60000 });
}
