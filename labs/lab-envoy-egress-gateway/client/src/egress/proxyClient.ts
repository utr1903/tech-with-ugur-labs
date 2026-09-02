import http from "node:http";

export type ProxyResponse =
  | { ok: true; status: number; bytes: number; bodyPreview: string }
  | { ok: false; error: string };

const PREVIEW_LIMIT = 120;

// A forward proxy expects the *absolute-form* request target: the request line
// carries the whole URL, so the gateway sees the :authority pseudo-header and
// can route on the destination FQDN. Node's fetch() does not honour HTTP_PROXY
// and undici's ProxyAgent tunnels with CONNECT, which would hide the authority
// and the body sizes from the gateway - so the request is made explicitly here.
export function requestViaProxy(args: {
  proxyHost: string;
  proxyPort: number;
  url: string;
  timeoutMs: number;
}): Promise<ProxyResponse> {
  const target = new URL(args.url);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: args.proxyHost,
        port: args.proxyPort,
        method: "GET",
        path: args.url,
        headers: { host: target.host },
        timeout: args.timeoutMs,
      },
      (res) => {
        let bytes = 0;
        let preview = "";
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (preview.length < PREVIEW_LIMIT) {
            preview += chunk.toString("utf8", 0, PREVIEW_LIMIT);
          }
        });
        res.on("end", () => {
          resolve({
            ok: true,
            status: res.statusCode ?? 0,
            bytes,
            bodyPreview: preview.slice(0, PREVIEW_LIMIT),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT")));
    req.on("error", (err: NodeJS.ErrnoException) =>
      resolve({ ok: false, error: err.code ?? err.message }),
    );
    req.end();
  });
}
