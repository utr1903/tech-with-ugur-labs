import { createServer, type RequestListener } from "node:http";
import { KubeConfig } from "@kubernetes/client-node";
import { afterEach, expect, it } from "vitest";
import { KubeTransport } from "./http.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
	for (const server of servers) {
		server.closeAllConnections();
		server.close();
	}
});
async function fixture(handler: RequestListener) {
	const server = createServer(handler);
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("Missing address");
	const config = new KubeConfig();
	config.loadFromClusterAndUser(
		{
			name: "test",
			skipTLSVerify: true,
			server: `http://127.0.0.1:${addr.port}`,
		},
		{ name: "test" },
	);
	return new KubeTransport(config, 100);
}
it("aborts a stalled request including a response that never ends", async () => {
	const transport = await fixture((_req, res) => {
		res.writeHead(200);
		res.write("x");
	});
	const start = Date.now();
	await expect(transport.request("GET", "/", undefined, 32768)).rejects.toThrow(
		/deadline/i,
	);
	expect(Date.now() - start).toBeLessThan(1000);
});
it("externally caps a lying server response instead of trusting limitBytes", async () => {
	const transport = await fixture((_req, res) => {
		res.writeHead(200);
		res.end(Buffer.alloc(100000, 65));
	});
	const result = await transport.request("GET", "/", undefined, 32768);
	expect(result.data.length).toBe(32768);
	expect(result.incomplete).toBe(true);
});
it("sends DELETE UID preconditions and foreground propagation on the wire", async () => {
	let received = "";
	const transport = await fixture((req, res) => {
		req.on("data", (data) => {
			received += String(data);
		});
		req.on("end", () => {
			res.end("{}");
		});
	});
	await transport.request(
		"DELETE",
		"/",
		{ propagationPolicy: "Foreground", preconditions: { uid: "owned-uid" } },
		1024,
	);
	expect(received).toBe(
		'{"propagationPolicy":"Foreground","preconditions":{"uid":"owned-uid"}}',
	);
});
it("preserves received log bytes when a stream stalls after complete early frames", async () => {
	const transport = await fixture((_req, res) => {
		res.writeHead(200);
		res.write("early-complete-frame\n");
	});
	const result = await transport.request("GET", "/", undefined, 32768, true);
	expect(result.data.toString()).toBe("early-complete-frame\n");
	expect(result.incomplete).toBe(true);
});
