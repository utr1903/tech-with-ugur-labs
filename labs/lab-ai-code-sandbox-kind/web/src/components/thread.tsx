"use client";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { CodeExecutorCard } from "./code-executor-card";
import { MarkdownText } from "./markdown-text";

function UserMessage() {
  return (
    <MessagePrimitive.Root
      className="message message-user"
      data-testid="user-message"
    >
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      className="message message-assistant"
      data-testid="assistant-message"
    >
      <MessagePrimitive.Parts
        components={{
          Text: MarkdownText,
          tools: { by_name: { code_executor: CodeExecutorCard } },
        }}
      />
    </MessagePrimitive.Root>
  );
}

export function Thread() {
  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <ThreadPrimitive.Empty>
          <p className="thread-empty">
            Ask a maths word problem — the assistant writes Python and runs it
            in the sandbox.
          </p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input
          className="composer-input"
          placeholder="Describe a maths problem…"
          data-testid="composer-input"
        />
        <ComposerPrimitive.Send
          className="composer-send"
          data-testid="composer-send"
        >
          Send
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}
