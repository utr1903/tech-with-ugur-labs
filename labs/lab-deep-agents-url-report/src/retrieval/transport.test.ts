import { createServer } from "node:http";
import { expect, it } from "vitest";
import { pinnedFetch } from "./transport.js";

it("connects to the pinned address while preserving Host and the exact path", async () => {
	const server = createServer((request, response) => {
		response.setHeader("content-type", "text/plain");
		response.end(`${request.headers.host} ${request.url}`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing address");
		const url = new URL(
			`http://does-not-resolve.invalid:${address.port}/page?q=1`,
		);
		const response = await pinnedFetch(
			{ url, address: "127.0.0.1", family: 4 },
			new AbortController().signal,
		);
		expect(await response.text()).toBe(
			`does-not-resolve.invalid:${address.port} /page?q=1`,
		);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});
it("rejects invalid upstream status codes through the promise", async () => {
	const server = createServer((_request, response) => {
		response.writeHead(999);
		response.end("bad");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing address");
		await expect(
			pinnedFetch(
				{
					url: new URL(`http://example.com:${address.port}`),
					address: "127.0.0.1",
					family: 4,
				},
				AbortSignal.timeout(50),
			),
		).rejects.toThrow(/status/i);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
