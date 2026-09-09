import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { createSolarAgent } from "./setupAgent.js";

/**
 * Owns the agent's lifetime. It mounts once a session exists and disposes on
 * unmount, so a signed-out page has no agent listening to it.
 */
export function AgentMount() {
  const { session, getToken } = useAuth();

  useEffect(() => {
    if (!session) return;
    const agent = createSolarAgent(getToken);
    window.pageAgent = agent;
    return () => {
      delete window.pageAgent;
      agent.dispose();
    };
  }, [session, getToken]);

  return null;
}
