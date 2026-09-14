import type { Logger } from "./logger";
import {
  downstreamResponseHeaders,
  upstreamRequestHeaders,
} from "./proxy-headers";

// Streams /api/* to the Hono server so the browser needs a single origin and
// the reader a single port-forward. The upstream URL is built from the
// request's path and query only, with the host fixed by SERVER_URL, and the
// request body is streamed straight through. Only the method, path and
// response status are logged — never the query string or the body — so chat
// text never lands in logs.
export function createServerProxy({ logger }: { logger: Logger }) {
  return async function forwardToServer(request: Request): Promise<Response> {
    const serverUrl = process.env.SERVER_URL ?? "http://localhost:8080";
    const incoming = new URL(request.url);
    const path = incoming.pathname;
    const method = request.method;
    const target = new URL(`${path}${incoming.search}`, serverUrl);
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: upstreamRequestHeaders(request.headers),
      signal: request.signal,
    };
    if (method !== "GET" && method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    try {
      logger.info({ method, path }, "Forwarding request to server...");
      const upstream = await fetch(target, init);
      logger.info(
        { method, path, status: upstream.status },
        "Forwarding request to server succeeded.",
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers: downstreamResponseHeaders(upstream.headers),
      });
    } catch (err) {
      logger.error(
        { err, method, path },
        "Forwarding request to server failed.",
      );
      throw err;
    }
  };
}
