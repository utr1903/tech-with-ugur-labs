"use client";
import { useEffect, useState } from "react";
import { ChatThread } from "./thread";
import { request } from "./transport";

type Thread = { id: string; created_at: string };
export function Conversations() {
	const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:3001";
	const [threads, setThreads] = useState<Thread[]>([]);
	const [selected, setSelected] = useState("");
	const [error, setError] = useState("");
	useEffect(() => {
		void request<{ threads: Thread[] }>(base, "/threads")
			.then((data) => {
				setThreads(data.threads);
				const prior = localStorage.getItem("contained-chat:selected");
				if (prior && data.threads.some((thread) => thread.id === prior))
					setSelected(prior);
			})
			.catch((err) =>
				setError(
					err instanceof Error ? err.message : "Conversations unavailable.",
				),
			);
	}, [base]);
	function select(id: string) {
		setSelected(id);
		localStorage.setItem("contained-chat:selected", id);
	}
	async function create() {
		try {
			const thread = await request<{ id: string }>(base, "/threads", {
				method: "POST",
			});
			setThreads((current) => [
				{ ...thread, created_at: new Date().toISOString() },
				...current,
			]);
			select(thread.id);
			setError("");
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Conversation unavailable.",
			);
		}
	}
	return (
		<main>
			<aside>
				<h1>Python chat</h1>
				<button type="button" onClick={() => void create()}>
					New conversation
				</button>
				<nav aria-label="Conversations">
					{threads.map((thread, index) => (
						<button
							type="button"
							key={thread.id}
							aria-pressed={selected === thread.id}
							onClick={() => select(thread.id)}
						>
							Conversation {threads.length - index}
						</button>
					))}
				</nav>
			</aside>
			<section>
				{error && <p role="alert">{error}</p>}
				{selected ? (
					<ChatThread key={selected} id={selected} base={base} />
				) : (
					<p>Create a conversation to begin.</p>
				)}
			</section>
		</main>
	);
}
