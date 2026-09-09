// The tests drive `window.pageAgent`, which the app under test installs
// (see frontend/src/agent/AgentMount.tsx). This suite has no dependency on
// the `page-agent` package itself, so it declares only the sliver of the
// browser-side API these tests actually call.
interface PageAgentExecutionResult {
  success: boolean;
}

interface Window {
  pageAgent?: {
    execute(task: string): Promise<PageAgentExecutionResult>;
  };
}
