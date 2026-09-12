"use client";
import { useEffect, useRef, useState } from "react";
import { createAudioLevel } from "../voice/audio-level";
import { createController } from "../voice/controller";
import { fetchAnswer, fetchToken } from "../voice/http";
import { createRealtime } from "../voice/realtime";
import { createScripted } from "../voice/scripted";
import type { State } from "../voice/transport";
import { VoiceOrb } from "./voice-orb";
export default function Page() {
	const [state, setState] = useState<State>({ status: "Stopped" });
	const [level, setLevel] = useState(0);
	const observer = useRef<ReturnType<typeof createAudioLevel> | null>(null);
	const [question, setQuestion] = useState("");
	const [initialized, setInitialized] = useState(false);
	const controller = useRef<ReturnType<typeof createController> | null>(null);
	useEffect(() => {
		const c = createController({
			sessionId: () => crypto.randomUUID(),
			token: fetchToken,
			relay: fetchAnswer,
			transport: (mode) => {
				if (mode === "scripted") observer.current?.dispose();
				return mode === "live"
					? createRealtime(undefined, observer.current ?? undefined)
					: createScripted(() =>
							navigator.mediaDevices.getUserMedia({ audio: true }),
						);
			},
			change: (next) => {
				if (next.status === "Error" || next.status === "Stopped")
					observer.current?.dispose();
				setState(next);
			},
		});
		controller.current = c;
		setInitialized(true);
		return () => {
			controller.current = null;
			c.stop();
			observer.current?.dispose();
		};
	}, []);
	return (
		<main>
			<header>
				<a href="/" className="brand">
					<span className="brand-mark">◈</span> Voice library
				</a>
				<span className="header-note">Knowledge, in conversation</span>
			</header>
			<div className="hero">
				<div className="introduction">
					<p className="eyebrow">A LITTLE KNOWLEDGE. A NATURAL CONVERSATION.</p>
					<h1>
						Your documents.
						<br />A voice.
					</h1>
					<p className="subtitle">
						Make room for curiosity. Ask a question, and find answers grounded
						in your library.
					</p>
				</div>
				<VoiceOrb level={level} />
			</div>
			<div className="session-panel">
				<p className="session-help">
					Start requests microphone access. Stop releases it and clears the
					session. The default simulated transport accepts a typed question; it
					does not recognize or synthesize speech.
				</p>
				<button
					type="button"
					disabled={!initialized}
					onClick={() => {
						observer.current?.dispose();
						observer.current = createAudioLevel(setLevel);
						observer.current.prepare();
						void controller.current?.start();
					}}
				>
					Start
				</button>{" "}
				<button
					type="button"
					disabled={!initialized}
					className="secondary"
					onClick={() => {
						controller.current?.stop();
						observer.current?.dispose();
					}}
				>
					Stop
				</button>
				<p className="session-status" role="status">
					{state.status}
				</p>
				<p>
					{state.mode === "live"
						? "Live voice transport — speak a question."
						: state.mode === "scripted"
							? "Simulated transport — no live inference or speech."
							: "No active transport."}
				</p>
				{state.mode === "live" && (
					<p aria-live="polite">
						{level > 0.08 ? "Agent speaking" : "Listening for your question"}
					</p>
				)}
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
						/>
						<button type="submit" disabled={state.status !== "Ready"}>
							Ask
						</button>
					</form>
				)}
			</div>
			{state.query && (
				<section aria-label="Recognized question">
					<h2>Question</h2>
					<p>{state.query}</p>
				</section>
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
