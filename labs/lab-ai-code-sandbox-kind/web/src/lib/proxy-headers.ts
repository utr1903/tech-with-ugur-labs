const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function without(headers: Headers, names: readonly string[]): Headers {
  const copy = new Headers(headers);
  for (const name of names) copy.delete(name);
  return copy;
}

export function upstreamRequestHeaders(headers: Headers): Headers {
  return without(headers, [...HOP_BY_HOP, "host", "content-length"]);
}

export function downstreamResponseHeaders(headers: Headers): Headers {
  return without(headers, [
    ...HOP_BY_HOP,
    "content-encoding",
    "content-length",
  ]);
}
