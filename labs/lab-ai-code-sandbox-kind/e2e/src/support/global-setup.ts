import type { TestProject } from "vitest/node";
import { SANDBOX_URL, WEB_URL } from "./cluster.js";
import { startPortForward, waitForHttp } from "./port-forward.js";

declare module "vitest" {
  export interface ProvidedContext {
    expectedLlmMode: "scripted" | "live";
  }
}

// Opens the suite's own tunnels (13000 → web, 18000 → sandbox) next to the
// reader's localhost:3000 forward, and closes only these on teardown.
export default async function setup(project: TestProject) {
  const forwards = [
    startPortForward("web", 13000, 3000),
    startPortForward("sandbox", 18000, 8000),
  ];
  const closeForwards = () => {
    for (const forward of forwards) forward.kill();
  };
  try {
    await waitForHttp(`${WEB_URL}/api/tools`);
    await waitForHttp(`${SANDBOX_URL}/capabilities`);
    const expected = project.config.provide?.expectedLlmMode;
    const response = await fetch(`${WEB_URL}/api/tools`);
    const tools = (await response.json()) as { llmMode: string };
    if (expected && tools.llmMode !== expected) {
      throw new Error(
        `The server runs in LLM_MODE=${tools.llmMode} but this suite needs ${expected}. Run \`make deploy LLM_MODE=${expected}\` first.`,
      );
    }
  } catch (err) {
    closeForwards();
    throw err;
  }
  return closeForwards;
}
