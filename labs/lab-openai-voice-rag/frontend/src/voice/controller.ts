import type { Call, Dependencies, State, Token, Transport } from "./transport";

type Session = {
	generation: number;
	abort: AbortController;
	transport?: Transport;
	token?: Token;
	seen: Set<string>;
};
const connectionError =
	"Connection failed. Check the services and microphone permission, then Start again.";
export function createController(deps: Dependencies) {
	let generation = 0;
	let active: Session | undefined;
	const current = (session: Session) =>
		active === session && session.generation === generation;
	function publish(session: Session, state: State) {
		if (current(session)) deps.change({ mode: session.token?.mode, ...state });
	}
	function dispose() {
		generation++;
		const old = active;
		active = undefined;
		old?.abort.abort();
		old?.transport?.dispose();
	}
	function fail(session: Session) {
		if (!current(session)) return;
		dispose();
		deps.change({ status: "Error", error: connectionError });
	}
	async function relay(session: Session, call: Call) {
		if (!current(session) || !session.token || session.seen.has(call.id))
			return;
		session.seen.add(call.id);
		publish(session, { status: "Retrieving" });
		try {
			const result = await deps.relay(
				session.token,
				call.question,
				session.abort.signal,
			);
			if (!current(session)) return;
			session.transport?.output(call.id, result);
			publish(session, { status: "Ready", answer: result });
		} catch {
			if (!current(session)) return;
			const error = "Knowledge request failed. Try another question.";
			try {
				session.transport?.output(call.id, { error });
				publish(session, { status: "Ready", error });
			} catch {
				fail(session);
			}
		}
	}
	async function start() {
		dispose();
		const session: Session = {
			generation,
			abort: new AbortController(),
			seen: new Set(),
		};
		active = session;
		publish(session, { status: "Connecting" });
		try {
			const token = await deps.token(session.abort.signal);
			if (!current(session)) return;
			session.token = token;
			session.transport = deps.transport(token.mode);
			await session.transport.start(
				token,
				(call) => {
					void relay(session, call);
				},
				() => fail(session),
			);
			publish(session, { status: "Ready" });
		} catch {
			fail(session);
		}
	}
	return {
		start,
		stop() {
			dispose();
			deps.change({ status: "Stopped" });
		},
		question(question: string) {
			active?.transport?.question(question);
		},
	};
}
