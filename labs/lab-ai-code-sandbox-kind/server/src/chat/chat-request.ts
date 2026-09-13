import { z } from "zod";

// The browser sends the whole visible conversation; the checkpointer already
// holds it, so only the newest user message is added to the graph.
const bodySchema = z.looseObject({
  threadId: z.uuid(),
  messages: z
    .array(
      z.looseObject({
        role: z.string(),
        parts: z.array(
          z.looseObject({ type: z.string(), text: z.string().optional() }),
        ),
      }),
    )
    .min(1),
});

export type ChatRequestResult =
  | { ok: true; value: { threadId: string; text: string } }
  | { ok: false; message: string };

export function parseChatRequest(body: unknown): ChatRequestResult {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      message:
        "body must contain threadId (UUID) and a non-empty messages array",
    };
  const lastUser = parsed.data.messages.findLast((m) => m.role === "user");
  const text = (lastUser?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text)
    return { ok: false, message: "the latest user message has no text" };
  return { ok: true, value: { threadId: parsed.data.threadId, text } };
}
