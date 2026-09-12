"use client";
import {
	type AppendMessage,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	clearPending,
	createTurn,
	loadPending,
	type Pending,
	savePending,
} from "./session";
import {
	applyEvent,
	type Message,
	reconcileMessages,
	request,
	streamTurn,
} from "./transport";

function display(message: Message): ThreadMessageLike {
	let text = message.text;
	if (message.role === "tool") {
		try {
			const result = JSON.parse(text);
			text = `Python ${result.status}\n${result.stdout}${result.stderr ? `\nStderr:\n${result.stderr}` : ""}${result.stdoutTruncated || result.stderrTruncated ? "\nOutput was bounded." : ""}`;
		} catch {
			text = "Running Python…";
		}
	}
	return {
		id: message.id,
		role: message.role === "tool" ? "assistant" : message.role,
		content: [{ type: "text", text }],
	};
}
export function useChatRuntime(base: string, threadId: string) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [ready, setReady] = useState(false);
	const [activeElsewhere, setActiveElsewhere] = useState(false);
	const controller = useRef<AbortController | null>(null);
	const busy = useRef(false);
	const connect = useCallback(
		async (saved: Pending) => {
			if (busy.current) return;
			busy.current = true;
			setRunning(true);
			setError("");
			setPending(true);
			const abort = new AbortController();
			controller.current = abort;
			try {
				await streamTurn(
					base,
					threadId,
					saved.request,
					saved.cursor,
					abort.signal,
					(event) => {
						if (event.sequence <= saved.cursor) return;
						saved.cursor = event.sequence;
						savePending(threadId, saved);
						setMessages((current) => applyEvent(current, event));
						if (event.type === "error") setError(event.message);
						if (event.type === "done" || event.type === "error") {
							clearPending(threadId);
							setPending(false);
						}
					},
				);
			} catch (err) {
				if (!abort.signal.aborted)
					setError(err instanceof Error ? err.message : "Chat unavailable.");
			} finally {
				busy.current = false;
				setRunning(false);
			}
		},
		[base, threadId],
	);
	useEffect(() => {
		let mounted = true;
		void request<{ messages: Message[]; activeTurn: { id: string } | null }>(
			base,
			`/threads/${threadId}/messages`,
		)
			.then((history) => {
				if (!mounted) return;
				setReady(true);
				const saved = loadPending(threadId);
				setMessages((current) =>
					reconcileMessages(
						reconcileMessages(current, saved?.request.messages ?? []),
						history.messages,
					),
				);
				if (saved) {
					setPending(true);
					void connect(saved);
				} else if (history.activeTurn) {
					setActiveElsewhere(true);
					setError(
						"This conversation is still running. Refresh shortly to see its result.",
					);
				}
			})
			.catch((err) => {
				if (mounted)
					setError(
						err instanceof Error ? err.message : "Conversation unavailable.",
					);
			});
		return () => {
			mounted = false;
			controller.current?.abort();
		};
	}, [base, threadId, connect]);
	const onNew = async (message: AppendMessage) => {
		if (busy.current || pending || !ready || activeElsewhere) return;
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (!text) return;
		const turn = createTurn(messages, text);
		const saved = { request: turn.request, cursor: 0 };
		savePending(threadId, saved);
		setMessages((current) => [...current, turn.message]);
		await connect(saved);
	};
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		convertMessage: display,
		onNew,
	});
	return {
		runtime,
		error,
		running,
		pending: pending || !ready || activeElsewhere,
		resumable: pending,
		resume: () => {
			const saved = loadPending(threadId);
			if (saved) void connect(saved);
		},
	};
}
