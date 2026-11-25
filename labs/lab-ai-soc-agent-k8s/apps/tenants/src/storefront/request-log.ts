import type { IncomingMessage } from "node:http";

export interface RequestLogFields {
  method: string;
  path: string;
  query: string;
  srcIp: string;
  userAgent: string;
}

type RequestLike = Pick<IncomingMessage, "method" | "url" | "headers"> & {
  socket: { remoteAddress?: string | undefined };
};

export function toRequestLogFields(req: RequestLike): RequestLogFields {
  const url = new URL(req.url ?? "/", "http://storefront.local");
  const forwarded = req.headers["x-forwarded-for"];
  const raw =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(",")[0]
      ?.trim() ??
    req.socket.remoteAddress ??
    "";
  return {
    method: req.method ?? "GET",
    path: url.pathname,
    query: url.search.replace(/^\?/, ""),
    srcIp: raw.replace(/^::ffff:/, ""),
    userAgent: String(req.headers["user-agent"] ?? ""),
  };
}
