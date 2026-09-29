import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { Target } from "./guard.js";

// Connect directly to the vetted IP. Host and TLS SNI retain the URL hostname;
// the default TLS certificate verification remains enabled.
export function pinnedFetch(
	target: Target,
	signal: AbortSignal,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const { url, address, family } = target;
		const request = url.protocol === "https:" ? httpsRequest : httpRequest;
		const req = request(
			{
				protocol: url.protocol,
				hostname: address,
				family,
				port: url.port || undefined,
				servername: url.hostname.replace(/^\[|\]$/g, ""),
				path: `${url.pathname}${url.search}`,
				method: "GET",
				agent: false,
				signal,
				headers: {
					host: url.host,
					accept: "text/html, text/plain",
					"accept-encoding": "identity",
				},
			},
			(response) => {
				try {
					resolve(toResponse(response));
				} catch (err) {
					response.destroy();
					reject(err);
				}
			},
		);
		req.on("error", reject);
		req.end();
	});
}

function toResponse(response: IncomingMessage): Response {
	const headers = new Headers();
	for (const [name, value] of Object.entries(response.headers)) {
		if (value !== undefined)
			headers.set(name, Array.isArray(value) ? value.join(", ") : value);
	}
	const status = response.statusCode ?? 500;
	const body = [204, 205, 304].includes(status)
		? null
		: (Readable.toWeb(response) as ReadableStream<Uint8Array>);
	if (!body) response.destroy();
	return new Response(body, { status, headers });
}
