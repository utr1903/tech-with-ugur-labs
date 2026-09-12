import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import {
	chat,
	configure,
	frontend,
	newThread,
	request,
	startForward,
	turn,
} from "../lib/application.js";
import {
	command,
	context,
	evidence,
	kube,
	kubeconfig,
	pause,
	save,
} from "../lib/commands.js";
import { browserCrash } from "./browser-crash.js";
import type { Assertion } from "./report.js";
export async function persistence(): Promise<Assertion[]> {
	await configure("tool");
	const id = await newThread();
	const body = turn("Remember the number 314159 and calculate 6 times 7.");
	await chat(id, body);
	const before = await (await request(`/threads/${id}/messages`)).json();
	kube(["rollout", "restart", "deployment/chat-backend", "-n", "executor-app"]);
	kube([
		"rollout",
		"status",
		"deployment/chat-backend",
		"-n",
		"executor-app",
		"--timeout=120s",
	]);
	await startForward();
	assert.deepEqual(
		await (await request(`/threads/${id}/messages`)).json(),
		before,
	);
	const separate = await newThread();
	assert.notEqual(id, separate);
	assert.deepEqual(
		(await (await request(`/threads/${separate}/messages`)).json()).messages,
		[],
	);
	const forward = spawn(
		command("which", ["kubectl"]).trim(),
		[
			"--kubeconfig",
			kubeconfig,
			"--context",
			context,
			"-n",
			"executor-app",
			"port-forward",
			"--address=127.0.0.1",
			"service/chat-frontend",
			"3000:3000",
		],
		{ stdio: "ignore" },
	);
	await pause(1000);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await page.goto(frontend);
		await page.waitForLoadState("networkidle");
		await page
			.getByRole("button", { name: "New conversation", exact: true })
			.click();
		await page.getByRole("textbox").fill("Calculate 6 times 7 with Python");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await page
			.getByText("succeeded", { exact: false })
			.first()
			.waitFor({ timeout: 60000 });
		await page
			.getByText("Working…", { exact: true })
			.waitFor({ state: "hidden" });
		const text = await page.locator("main").innerText();
		await page.reload();
		await page.getByText("succeeded", { exact: false }).first().waitFor();
		assert.equal(await page.locator("main").innerText(), text);
		assert.deepEqual(errors, []);
		await browserCrash(page);
		await page.screenshot({ path: `${evidence}/browser.png`, fullPage: true });
		save("persistence.json", { id, separate, before, browserErrors: errors });
	} finally {
		await browser.close();
		forward.kill();
	}
	return [
		{
			name: "persistence-browser-thread-isolation",
			layer: "browser/Postgres checkpoints",
			attempted:
				"restart backend, reload browser and isolate independent thread",
			status: "passed",
			evidence: "persistence.json",
		},
	];
}
