"use client";
import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
} from "@assistant-ui/react";
import { useChatRuntime } from "./runtime";

function ChatMessage() {
	return (
		<MessagePrimitive.Root className="message">
			<MessagePrimitive.Parts />
		</MessagePrimitive.Root>
	);
}
export function ChatThread({ base, id }: { base: string; id: string }) {
	const chat = useChatRuntime(base, id);
	return (
		<AssistantRuntimeProvider runtime={chat.runtime}>
			<ThreadPrimitive.Root className="thread">
				<ThreadPrimitive.Viewport className="transcript">
					<ThreadPrimitive.Empty>
						<p>Ask a question or try a Python calculation.</p>
					</ThreadPrimitive.Empty>
					<ThreadPrimitive.Messages
						components={{
							UserMessage: ChatMessage,
							AssistantMessage: ChatMessage,
						}}
					/>
				</ThreadPrimitive.Viewport>
				{chat.error && <p role="alert">{chat.error}</p>}
				{chat.resumable && !chat.running && (
					<button type="button" onClick={chat.resume}>
						Resume response
					</button>
				)}
				<ComposerPrimitive.Root className="composer">
					<ComposerPrimitive.Input
						aria-label="Message"
						placeholder="Write a message…"
						disabled={chat.pending}
					/>
					<ComposerPrimitive.Send disabled={chat.pending}>
						Send
					</ComposerPrimitive.Send>
				</ComposerPrimitive.Root>
				{chat.running && <p role="status">Working…</p>}
			</ThreadPrimitive.Root>
		</AssistantRuntimeProvider>
	);
}
