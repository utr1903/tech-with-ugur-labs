import { describe, expect, it } from "vitest";
import { guardUrl } from "./guard.js";

const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
describe("guardUrl", () => {
	it.each([
		"https://example.com/a",
		"http://8.8.8.8/",
		"https://[2606:4700:4700::1111]/",
	])("accepts public target %s", async (url) => {
		expect((await guardUrl(url, resolve)).url.href).toBe(url);
	});
	it.each([
		"file:///tmp/a",
		"ftp://example.com",
		"https://u:p@example.com",
		"http://localhost",
		"http://x.localhost",
		"http://example.local",
		"http://127.1",
		"http://10.0.0.1",
		"http://172.16.0.1",
		"http://192.168.0.1",
		"http://169.254.169.254",
		"http://100.64.0.1",
		"http://0.0.0.0",
		"http://224.0.0.1",
		"http://[::1]",
		"http://[::]",
		"http://[fd00::1]",
		"http://[fe80::1]",
		"http://[::ffff:127.0.0.1]",
		"http://[2001:db8::1]",
		"http://[2002:7f00:1::]",
	])("rejects nonpublic target %s", async (url) => {
		await expect(guardUrl(url, resolve)).rejects.toThrow(/public HTTP/);
	});
	it.each(
		[
			[],
			[{ address: "192.168.1.2", family: 4 }],
			[
				{ address: "93.184.216.34", family: 4 },
				{ address: "::1", family: 6 },
			],
		].map((answers) => ({ answers })),
	)("rejects empty or unsafe DNS results $answers", async ({ answers }) => {
		await expect(
			guardUrl("https://example.com", async () => answers),
		).rejects.toThrow(/public HTTP/);
	});
});
