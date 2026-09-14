import type { UIMessage } from "ai";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function loadHistory(
  threadId: string,
  {
    fetchImpl = fetch,
    signal,
  }: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<UIMessage[]> {
  const response = await fetchImpl(`/api/threads/${threadId}/messages`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`loading history failed: HTTP ${response.status}`);
  const body = (await response.json()) as { messages: UIMessage[] };
  return body.messages;
}
