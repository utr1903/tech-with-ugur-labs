import { createSpeechBuffer } from "./speech-buffer";
import type { Call, Dependencies, State, Token, Transport } from "./transport";

type Session = {
	id: string;
	abort: AbortController;
	transport?: Transport;
	token?: Token;
	seen: Set<string>;
	turn?: AbortController;
	state: State;
};
const connectionError =
	"Connection failed. Check the services and microphone permission, then Start again.";
export function createController(deps: Dependencies) {
	let active: Session | undefined;
	const current = (s: Session) => active === s;
	function publish(s: Session, state: Partial<State>) {
		if (current(s)) {
			s.state = { ...s.state, mode: s.token?.mode, ...state };
			deps.change(s.state);
		}
	}
	function interrupt(s: Session) {
		if (!current(s)) return;
		s.turn?.abort();
		s.turn = undefined;
		s.transport?.clearSpeech();
		publish(s, { status: "Ready" });
	}
	function dispose() {
		const old = active;
		active = undefined;
		old?.abort.abort();
		old?.turn?.abort();
		old?.transport?.dispose();
	}
	function fail(s: Session) {
		if (!current(s)) return;
		dispose();
		deps.change({ status: "Error", error: connectionError });
	}
	async function relay(s: Session, call: Call) {
		if (!current(s) || s.seen.has(call.id)) return;
		s.seen.add(call.id);
		interrupt(s);
		const turn = new AbortController();
		s.turn = turn;
		const live = () => current(s) && s.turn === turn && !turn.signal.aborted;
		const speech = createSpeechBuffer((text) => {
			if (live()) s.transport?.say(text);
		});
		publish(s, {
			status: "Searching",
			query: call.question,
			answer: { answer: "", sources: [] },
			error: undefined,
		});
		try {
			const result = await deps.relay(
				s.id,
				call.question,
				turn.signal,
				(event) => {
					if (!live()) return;
					switch (event.type) {
						case "status":
							publish(s, {
								status: event.stage === "searching" ? "Searching" : "Answering",
							});
							break;
						case "sources":
							publish(s, {
								answer: {
									answer: s.state.answer?.answer ?? "",
									sources: event.sources,
								},
							});
							break;
						case "delta":
							publish(s, {
								status: "Answering",
								answer: {
									answer: (s.state.answer?.answer ?? "") + event.text,
									sources: s.state.answer?.sources ?? [],
								},
							});
							speech.push(event.text);
							break;
						case "done":
							publish(s, {
								answer: { answer: event.answer, sources: event.sources },
							});
							break;
						case "error":
							throw Error("Knowledge request failed");
					}
				},
			);
			if (!live()) return;
			speech.finish();
			publish(s, { status: "Ready", answer: result });
		} catch {
			if (!live()) return;
			s.transport?.clearSpeech();
			publish(s, {
				status: "Ready",
				error: "Knowledge request failed. Ask another question to continue.",
			});
		}
	}
	async function start() {
		dispose();
		const s: Session = {
			id: deps.sessionId(),
			abort: new AbortController(),
			seen: new Set(),
			state: { status: "Connecting" },
		};
		active = s;
		publish(s, {});
		try {
			const token = await deps.token(s.abort.signal);
			if (!current(s)) return;
			s.token = token;
			s.transport = deps.transport(token.mode);
			await s.transport.start(
				token,
				(call) => {
					void relay(s, call);
				},
				() => fail(s),
				() => interrupt(s),
			);
			if (!s.turn) publish(s, { status: "Ready" });
		} catch {
			fail(s);
		}
	}
	return {
		start,
		stop() {
			dispose();
			deps.change({ status: "Stopped" });
		},
		question(text: string) {
			active?.transport?.question(text);
		},
	};
}
