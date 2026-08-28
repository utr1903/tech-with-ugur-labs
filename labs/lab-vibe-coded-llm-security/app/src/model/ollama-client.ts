import type { Logger } from "../logger.js";

export interface ChatDeps {
  baseUrl: string;
  model: string;
  logger: Logger;
  fetchFn?: typeof fetch;
}

interface OllamaGenerateResponse {
  response: string;
}

export async function chat(deps: ChatDeps, prompt: string): Promise<string> {
  const { baseUrl, model, logger, fetchFn } = deps;
  const doFetch = fetchFn ?? fetch;

  try {
    logger.info({ model }, "Calling the model...");
    const res = await doFetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0, seed: 0, top_k: 1 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed with status ${res.status}`);
    }

    const body = (await res.json()) as OllamaGenerateResponse;
    logger.info({ model }, "Calling the model succeeded.");
    return body.response;
  } catch (err) {
    logger.error({ err, model }, "Calling the model failed.");
    throw err;
  }
}
