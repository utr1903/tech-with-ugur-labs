import {
  downstreamResponseHeaders,
  upstreamRequestHeaders,
} from "./proxy-headers";

// Streams /api/* to the Hono server so the browser needs a single origin and
// the reader a single port-forward. Only the path and query are forwarded;
// the destination host always comes from SERVER_URL.
export async function forwardToServer(request: Request): Promise<Response> {
  const serverUrl = process.env.SERVER_URL ?? "http://localhost:8080";
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, serverUrl);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: upstreamRequestHeaders(request.headers),
    signal: request.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  const upstream = await fetch(target, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: downstreamResponseHeaders(upstream.headers),
  });
}
