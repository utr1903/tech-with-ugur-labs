import { PageAgent } from "page-agent";

/**
 * The agent talks to our own origin, not to a model provider. There is no
 * API key here — not an empty one, not a placeholder, none — so the library
 * sends no Authorization header of its own and customFetch supplies ours.
 */
export function createSolarAgent(getToken: () => string | null): PageAgent {
  return new PageAgent({
    baseURL: "/api/agent/v1",
    // The backend pins the real model; this name is only what the library
    // puts in the request body, and the relay overwrites it.
    model: "relayed",
    maxSteps: 20,
    // Extract the whole page, not just the viewport, so the agent never has to
    // scroll to find a form field.
    viewportExpansion: -1,
    customFetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      const token = getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return await fetch(input, { ...init, headers });
    },
  });
}
