"use client";
import { useEffect, useRef, useState } from "react";
import { createController } from "../voice/controller";
import { fetchAnswer, fetchToken } from "../voice/http";
import { createRealtime } from "../voice/realtime";
import { createScripted } from "../voice/scripted";
import type { State } from "../voice/transport";
export default function Page() {
	const [state, setState] = useState<State>({ status: "Stopped" });
	const [question, setQuestion] = useState("");
	const [initialized, setInitialized] = useState(false);
	const controller = useRef<ReturnType<typeof createController> | null>(null);
	useEffect(() => {
		const c = createController({
			token: fetchToken,
			relay: fetchAnswer,
			transport: (mode) =>
				mode === "live"
					? createRealtime()
					: createScripted(() =>
							navigator.mediaDevices.getUserMedia({ audio: true }),
						),
			change: setState,
		});
		controller.current = c;
		setInitialized(true);
		return () => {
			controller.current = null;
			c.stop();
		};
	}, []);
	return (
		<main>
			<h1>Markdown voice knowledge assistant</h1>
			<p>
				Start requests microphone access. Stop releases it and clears the
				session. The default simulated transport accepts a typed question; it
				does not recognize or synthesize speech.
			</p>
			<button
				type="button"
				disabled={!initialized}
				onClick={() => {
					void controller.current?.start();
				}}
			>
				Start
			</button>{" "}
			<button
				type="button"
				disabled={!initialized}
				onClick={() => controller.current?.stop()}
			>
				Stop
			</button>
			<p role="status">{state.status}</p>
			<p>
				{state.mode === "live"
					? "Live voice transport — speak a question."
					: state.mode === "scripted"
						? "Simulated transport — no live inference or speech."
						: "No active transport."}
			</p>
			{state.error && <p role="alert">{state.error}</p>}
			{state.mode === "scripted" && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						controller.current?.question(question);
					}}
				>
					<label htmlFor="question">Simulated question</label>
					<br />
					<input
						id="question"
						value={question}
						onChange={(e) => setQuestion(e.target.value)}
						maxLength={2000}
						required
						style={{ width: "80%" }}
					/>
					<button type="submit" disabled={state.status !== "Ready"}>
						Ask
					</button>
				</form>
			)}
			{state.answer && (
				<section aria-label="Answer">
					<h2>Answer</h2>
					<p>{state.answer.answer}</p>
					<h2>Sources</h2>
					<ul>
						{state.answer.sources.map((source) => (
							<li key={source.id}>
								<strong>
									{source.filename} · chunk {source.ordinal}
								</strong>
								<p>{source.text}</p>
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}
