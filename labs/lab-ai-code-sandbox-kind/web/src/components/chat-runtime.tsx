"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import type { UIMessage } from "ai";
import { useMemo } from "react";
import { Thread } from "./thread";

export function ChatRuntime({
  threadId,
  initialMessages,
}: {
  threadId: string;
  initialMessages: UIMessage[];
}) {
  const transport = useMemo(
    () => new AssistantChatTransport({ api: "/api/chat", body: { threadId } }),
    [threadId],
  );
  const runtime = useChatRuntime({
    id: threadId,
    messages: initialMessages,
    transport,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
