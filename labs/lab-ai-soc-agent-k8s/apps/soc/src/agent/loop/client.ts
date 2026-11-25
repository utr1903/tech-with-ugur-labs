import Anthropic from "@anthropic-ai/sdk";
import type { RunnerFactory } from "./request.js";

/** Real runner factory. The client reads ANTHROPIC_API_KEY from the environment; nothing is sent until a run starts. */
export function createAnthropicRunnerFactory(): RunnerFactory {
  const client = new Anthropic();
  return (params) =>
    client.beta.messages.toolRunner({ ...params, stream: false });
}
