import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./src",
	testMatch: "**/*.browser.test.ts",
	timeout: 60_000,
	workers: 1,
	use: {
		baseURL: process.env.BROWSER_BASE_URL ?? "http://localhost:3000",
		headless: true,
		permissions: ["microphone"],
		launchOptions: {
			args: [
				"--use-fake-device-for-media-stream",
				"--use-fake-ui-for-media-stream",
				...(process.env.LIVE_AUDIO_FILE
					? [`--use-file-for-fake-audio-capture=${process.env.LIVE_AUDIO_FILE}`]
					: []),
			],
		},
	},
	reporter: "list",
});
