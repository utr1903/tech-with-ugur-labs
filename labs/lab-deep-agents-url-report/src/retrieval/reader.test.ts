import { expect, it } from "vitest";
import { type ReaderDependencies, readUrl } from "./reader.js";

const url = "https://example.com/page";
const plain = (text = "Source facts") =>
	new Response(text, { headers: { "content-type": "text/plain" } });
const dependencies: ReaderDependencies = {
	resolve: async () => [{ address: "93.184.216.34", family: 4 }],
	fetch: async () => plain(),
};
it("returns source text and requested/final URLs", async () => {
	expect(await readUrl(url, dependencies)).toEqual({
		requestedUrl: url,
		finalUrl: url,
		status: "ok",
		text: "Source facts",
	});
});
it("passes the vetted address to the transport, with no second DNS lookup", async () => {
	let lookups = 0;
	const result = await readUrl(url, {
		...dependencies,
		resolve: async () => [
			{ address: ++lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
		],
		fetch: async (target) => plain(`${target.address} ${target.url.hostname}`),
	});
	expect(result.text).toBe("93.184.216.34 example.com");
	expect(lookups).toBe(1);
});
it("blocks private DNS before any connection", async () => {
	let connections = 0;
	const result = await readUrl(url, {
		...dependencies,
		resolve: async () => [{ address: "127.0.0.1", family: 4 }],
		fetch: async () => {
			connections++;
			return plain();
		},
	});
	expect(result.status).toBe("failed");
	expect(connections).toBe(0);
	expect(result.error).toMatch(/public HTTP/);
});
it("rechecks DNS on a redirect to the same hostname", async () => {
	let lookups = 0;
	let connections = 0;
	const result = await readUrl(url, {
		...dependencies,
		resolve: async () => [
			{ address: ++lookups === 1 ? "93.184.216.34" : "10.0.0.1", family: 4 },
		],
		fetch: async () => {
			connections++;
			return new Response(null, {
				status: 302,
				headers: { location: "/next" },
			});
		},
	});
	expect(result.status).toBe("failed");
	expect(connections).toBe(1);
});
it("blocks redirects to private literal addresses", async () => {
	let connections = 0;
	const result = await readUrl(url, {
		...dependencies,
		fetch: async () => {
			connections++;
			return new Response(null, {
				status: 302,
				headers: { location: "http://169.254.169.254/" },
			});
		},
	});
	expect(result.error).toMatch(/public HTTP/);
	expect(connections).toBe(1);
});
it("follows relative public redirects and records the final URL", async () => {
	const result = await readUrl(url, {
		...dependencies,
		fetch: async (target) =>
			target.url.pathname === "/page"
				? new Response(null, { status: 301, headers: { location: "/next" } })
				: plain(),
	});
	expect(result).toMatchObject({
		status: "ok",
		finalUrl: "https://example.com/next",
	});
});
it("limits redirect loops", async () => {
	let connections = 0;
	const result = await readUrl(url, {
		...dependencies,
		maxRedirects: 2,
		fetch: async () => {
			connections++;
			return new Response(null, {
				status: 302,
				headers: { location: "/page" },
			});
		},
	});
	expect(result.error).toMatch(/redirect/i);
	expect(connections).toBe(3);
});
it("extracts HTML text, decodes entities, and excludes executable/navigation content", async () => {
	const result = await readUrl(url, {
		...dependencies,
		fetch: async () =>
			new Response(
				"<nav>menu</nav><main><h1>Title</h1><p>A &amp; B</p><script>evil()</script><style>secret</style></main>",
				{ headers: { "content-type": "text/html; charset=utf-8" } },
			),
	});
	expect(result.text).toBe("Title A & B");
});
it.each(["application/json", "image/png"])(
	"rejects unsupported content %s",
	async (mime) => {
		expect(
			(
				await readUrl(url, {
					...dependencies,
					fetch: async () =>
						new Response("data", { headers: { "content-type": mime } }),
				})
			).error,
		).toMatch(/content type/i);
	},
);
it("rejects oversized streaming bodies without a Content-Length", async () => {
	expect((await readUrl(url, { ...dependencies, maxBytes: 3 })).error).toMatch(
		/byte limit/i,
	);
});
it("bounds stalled DNS with the overall timeout", async () => {
	expect(
		(
			await readUrl(url, {
				...dependencies,
				timeoutMs: 10,
				resolve: () => new Promise(() => {}),
			})
		).error,
	).toMatch(/timed out/i);
});
it("aborts stalled response streams on timeout", async () => {
	let cancelled = false;
	const result = await readUrl(url, {
		...dependencies,
		timeoutMs: 10,
		fetch: async () =>
			new Response(
				new ReadableStream({
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "content-type": "text/plain" } },
			),
	});
	expect(result.error).toMatch(/timed out/i);
	expect(cancelled).toBe(true);
});
it("reports HTTP failures without treating error pages as source text", async () => {
	expect(
		(
			await readUrl(url, {
				...dependencies,
				fetch: async () => new Response("missing", { status: 404 }),
			})
		).error,
	).toMatch(/404/);
});
it("bounds error strings", async () => {
	const result = await readUrl(url, {
		...dependencies,
		fetch: async () => {
			throw new Error("x".repeat(1000));
		},
	});
	expect(result.status).toBe("failed");
	expect(result.error?.length).toBeLessThanOrEqual(300);
	expect(result.error).toMatch(/^x+$/);
});
