export type Response = {
  status: number;
  body: {
    id?: string;
    exitCode?: number;
    output?: string;
    truncated?: boolean;
    error?: string;
  };
};
// Bound client transport beyond the server budget so deadline responses and cleanup can be observed.
export async function post(
  endpoint: string,
  body: string,
  timeout = 70000,
): Promise<Response> {
  const response = await fetch(`${endpoint}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeout),
  });
  return {
    status: response.status,
    body: (await response.json()) as Response["body"],
  };
}
