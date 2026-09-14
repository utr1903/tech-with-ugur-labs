"use client";

import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import { loadHistory } from "../lib/load-history";
import { ChatRuntime } from "./chat-runtime";

// Loads the stored conversation first, then mounts the runtime with it, so a
// reload shows exactly what the server remembers.
export function ChatScreen({ threadId }: { threadId: string }) {
  const [history, setHistory] = useState<UIMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(threadId, { signal: controller.signal }).then(
      setHistory,
      (err: unknown) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => controller.abort();
  }, [threadId]);

  return (
    <main className="app">
      <header className="app-header">
        <h1>Maths with a code sandbox</h1>
        {/* A full navigation: the server picks a fresh thread id. */}
        <a className="new-chat" href="/" data-testid="new-chat">
          New chat
        </a>
      </header>
      {error && <p role="alert">Could not load this chat: {error}</p>}
      {!error && history === null && (
        <p className="thread-empty">Loading chat…</p>
      )}
      {!error && history !== null && (
        <ChatRuntime
          key={threadId}
          threadId={threadId}
          initialMessages={history}
        />
      )}
    </main>
  );
}
