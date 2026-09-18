import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WEB_URL } from "./cluster.js";
import { readUIChunks, type UIChunk } from "./ui-stream.js";

const historySchema = z.object({
  threadId: z.uuid(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      parts: z.array(z.looseObject({ type: z.string() })),
    }),
  ),
});

const toolsSchema = z.object({
  llmMode: z.string(),
  tools: z.array(z.object({ name: z.string(), description: z.string() })),
});

type HistoryMessage = z.infer<typeof historySchema>["messages"][number];

// Everything goes through the web app's /api proxy, like the browser does.
export async function sendChat(
  threadId: string,
  text: string,
): Promise<UIChunk[]> {
  const response = await fetch(`${WEB_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: threadId,
      threadId,
      trigger: "submit-message",
      messages: [
        { id: randomUUID(), role: "user", parts: [{ type: "text", text }] },
      ],
    }),
  });
  if (response.status !== 200)
    throw new Error(
      `chat returned HTTP ${response.status}: ${await response.text()}`,
    );
  return readUIChunks(response);
}

export async function loadHistory(threadId: string): Promise<HistoryMessage[]> {
  const response = await fetch(`${WEB_URL}/api/threads/${threadId}/messages`);
  if (response.status !== 200)
    throw new Error(`history returned HTTP ${response.status}`);
  const history = historySchema.parse(await response.json());
  if (history.threadId !== threadId)
    throw new Error(
      `history for ${threadId} came back for thread ${history.threadId}`,
    );
  return history.messages;
}

export async function getTools(): Promise<z.infer<typeof toolsSchema>> {
  const response = await fetch(`${WEB_URL}/api/tools`);
  if (response.status !== 200)
    throw new Error(`tools returned HTTP ${response.status}`);
  return toolsSchema.parse(await response.json());
}
