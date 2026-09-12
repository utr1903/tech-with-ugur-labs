import type OpenAI from "openai";
import { SafeError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import { logOperation } from "../operation.js";

async function requestSecret(client: OpenAI, signal: AbortSignal) {
	try {
		const response = await client.realtime.clientSecrets.create(
			{
				session: {
					type: "realtime",
					model: "gpt-realtime-2.1",
					audio: {
						input: {
							transcription: {
								model: "gpt-4o-transcribe",
								prompt:
									"Transcribe verbatim. Preserve ordinary color and component names.",
							},
							turn_detection: {
								type: "server_vad",
								create_response: false,
								interrupt_response: false,
							},
						},
						output: { voice: "marin" },
					},
					instructions: "Read supplied phrases aloud faithfully.",
					tools: [],
					tool_choice: "none",
				},
			},
			{ signal },
		);
		return response.value;
	} catch {
		throw new SafeError("Voice session creation failed");
	}
}

export function realtimeSecret(
	client: OpenAI,
	signal: AbortSignal,
	logger: Logger,
) {
	return logOperation(
		logger,
		"Create live agent token",
		{ model: "gpt-realtime-2.1" },
		() => requestSecret(client, signal),
		() => ({ created: true }),
	);
}
