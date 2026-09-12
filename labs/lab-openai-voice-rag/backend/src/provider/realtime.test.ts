import type OpenAI from "openai";
import { expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { realtimeSecret } from "./realtime.js";

it("configures verbatim input transcription with automatic model replies and tools disabled", async () => {
	let request: unknown;
	const client = {
		realtime: {
			clientSecrets: {
				create: async (value: unknown) => {
					request = value;
					return { value: "ephemeral" };
				},
			},
		},
	} as unknown as OpenAI;
	const logger = createLogger({ appName: "token-test" });
	logger.level = "silent";
	expect(
		await realtimeSecret(client, new AbortController().signal, logger),
	).toBe("ephemeral");
	expect(request).toMatchObject({
		session: {
			tools: [],
			tool_choice: "none",
			audio: {
				input: {
					transcription: { model: "gpt-4o-transcribe" },
					turn_detection: {
						type: "server_vad",
						create_response: false,
						interrupt_response: false,
					},
				},
			},
		},
	});
});
