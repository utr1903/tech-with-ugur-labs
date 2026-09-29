import { load } from "cheerio";
import { guardUrl, type Resolver, type Target } from "./guard.js";
import { pinnedFetch } from "./transport.js";

export interface ReaderDependencies {
	resolve?: Resolver;
	/** Trusted transport seam: must connect only to target.address. */
	fetch?: (target: Target, signal: AbortSignal) => Promise<Response>;
	maxRedirects?: number;
	maxBytes?: number;
	timeoutMs?: number;
}
export interface ReadResult {
	requestedUrl: string;
	finalUrl?: string;
	status: "ok" | "failed";
	text?: string;
	error?: string;
}
async function readBody(
	response: Response,
	maxBytes: number,
	signal: AbortSignal,
): Promise<string> {
	if (Number(response.headers.get("content-length")) > maxBytes)
		throw new Error("Response exceeds byte limit");
	const reader = response.body?.getReader();
	if (!reader) return "";
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw new Error("Response exceeds byte limit");
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		signal.removeEventListener("abort", abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
function extractText(body: string, mime: string): string {
	if (mime === "text/plain") return body.trim();
	const $ = load(body);
	$(
		'script,style,noscript,nav,header,footer,svg,iframe,form,[hidden],[aria-hidden="true"]',
	).remove();
	$("h1,h2,h3,h4,h5,h6,p,div,li,br,tr,section").append(" ");
	const main = $("main,article").first();
	return (main.length ? main.text() : $("body").text())
		.replace(/\s+/g, " ")
		.trim();
}
async function readResponse(
	response: Response,
	maxBytes: number,
	signal: AbortSignal,
): Promise<string> {
	if (!response.ok) throw new Error(`HTTP status ${response.status}`);
	const mime =
		response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
		"";
	if (!["text/html", "text/plain"].includes(mime))
		throw new Error("Unsupported content type");
	if (
		!["identity", ""].includes(response.headers.get("content-encoding") ?? "")
	)
		throw new Error("Unsupported content encoding");
	const body = await readBody(response, maxBytes, signal);
	return extractText(body, mime);
}
async function retrieve(
	requestedUrl: string,
	deps: ReaderDependencies,
	signal: AbortSignal,
	setFinal: (url: string) => void,
): Promise<string> {
	let current = requestedUrl;
	for (let hop = 0; ; hop++) {
		const target = await guardUrl(current, deps.resolve);
		signal.throwIfAborted();
		setFinal(target.url.href);
		const response = await (deps.fetch ?? pinnedFetch)(target, signal);
		try {
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				if (hop >= (deps.maxRedirects ?? 5))
					throw new Error("Redirect limit exceeded");
				const location = response.headers.get("location");
				if (!location) throw new Error("Redirect has no location");
				current = new URL(location, target.url).href;
				continue;
			}
			return await readResponse(response, deps.maxBytes ?? 2_000_000, signal);
		} finally {
			await response.body?.cancel().catch(() => {});
		}
	}
}
export async function readUrl(
	requestedUrl: string,
	dependencies: ReaderDependencies = {},
): Promise<ReadResult> {
	const controller = new AbortController();
	let finalUrl: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			const err = new Error("Reading URL timed out");
			controller.abort(err);
			reject(err);
		}, dependencies.timeoutMs ?? 15_000);
	});
	try {
		const text = await Promise.race([
			retrieve(requestedUrl, dependencies, controller.signal, (url) => {
				finalUrl = url;
			}),
			timeout,
		]);
		return { requestedUrl, finalUrl, status: "ok", text };
	} catch (err) {
		return {
			requestedUrl,
			finalUrl,
			status: "failed",
			error: (err instanceof Error ? err.message : "Reading URL failed").slice(
				0,
				300,
			),
		};
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}
