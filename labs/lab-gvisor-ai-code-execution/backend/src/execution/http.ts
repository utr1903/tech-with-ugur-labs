import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { KubeConfig } from "@kubernetes/client-node";

type Response = { data: Buffer; incomplete: boolean; status: number };
export class KubeTransport {
	constructor(
		private readonly config: KubeConfig,
		private readonly timeout = 2000,
	) {}
	async request(
		method: string,
		path: string,
		body: unknown,
		cap: number,
		partial = false,
	): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(
			() =>
				controller.abort(new Error("Kubernetes request deadline exceeded.")),
			this.timeout,
		);
		try {
			const server = this.config.getCurrentCluster()?.server;
			if (!server) throw new Error("Missing Kubernetes cluster.");
			const options: RequestOptions = {
				method,
				headers: {
					"Content-Type": "application/json",
					...(body === undefined
						? {}
						: { "Content-Length": Buffer.byteLength(JSON.stringify(body)) }),
				},
				signal: controller.signal,
			};
			await Promise.race([
				this.config.applyToHTTPSOptions(options),
				new Promise<never>((_, reject) =>
					controller.signal.addEventListener(
						"abort",
						() => reject(controller.signal.reason),
						{ once: true },
					),
				),
			]);
			controller.signal.throwIfAborted();
			return await this.send(
				new URL(path, server),
				options,
				body,
				cap,
				controller.signal,
				partial,
			);
		} finally {
			clearTimeout(timer);
		}
	}

	private send(
		url: URL,
		options: RequestOptions,
		body: unknown,
		cap: number,
		signal: AbortSignal,
		partial: boolean,
	): Promise<Response> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let size = 0;
			let status = 0;
			const done = (incomplete: boolean) =>
				resolve({ data: Buffer.concat(chunks, size), incomplete, status });
			const failed = (err: Error) => {
				if (partial && size > 0) done(true);
				else reject(signal.aborted ? signal.reason : err);
			};
			const send = url.protocol === "https:" ? httpsRequest : httpRequest;
			const req = send(url, options, (res) => {
				status = res.statusCode ?? 0;
				res.on("data", (data: Buffer) => {
					const bounded = data.subarray(0, cap - size);
					chunks.push(bounded);
					size += bounded.length;
					if (size >= cap) {
						done(true);
						res.destroy();
						req.destroy();
					}
				});
				res.on("end", () => done(false));
				res.on("error", failed);
			});
			req.on("error", failed);
			req.end(body === undefined ? undefined : JSON.stringify(body));
		});
	}
}
