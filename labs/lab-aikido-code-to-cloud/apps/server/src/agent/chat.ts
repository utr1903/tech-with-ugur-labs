import { createAgent } from "langchain";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AuthUser } from "../auth/middleware";
import type { Store } from "../data/s3";
import { buildTools } from "../tools";
import { buildSystemPrompt } from "./prompt";
import type { SessionStore } from "./memory";

export interface ChatService {
  chat(input: { user: AuthUser; message: string; sessionId?: string }): Promise<{ reply: string; sessionId: string }>;
}

function textOf(m: BaseMessage): string {
  const c = m.content as unknown;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text : ""))
      .join("");
  }
  return "";
}

export function createChatService(deps: {
  model: BaseChatModel;
  store: Store;
  sessions: SessionStore;
  now?: () => Date;
}): ChatService {
  const now = deps.now ?? (() => new Date());
  return {
    async chat({ user, message, sessionId }) {
      const id = sessionId || deps.sessions.newId();
      // history is bound to the customer so one user cannot replay another's session id
      const key = `${user.customerId}:${id}`;
      const history = deps.sessions.get(key);
      const tools = buildTools({ store: deps.store, customerId: user.customerId });
      const agent = createAgent({
        model: deps.model,
        tools,
        systemPrompt: buildSystemPrompt({ user, message, today: now().toISOString().slice(0, 10) }),
      });
      const human = new HumanMessage(message);
      // INSECURE-BY-DESIGN: recursionLimit of 1000 allows effectively unbounded agent iterations (cost/DoS)
      const result = await agent.invoke({ messages: [...history, human] }, { recursionLimit: 1000 });
      const messages = result.messages as BaseMessage[];
      const fresh = messages.slice(history.length + 1);
      const last = [...fresh].reverse().find((m) => AIMessage.isInstance(m)) as BaseMessage | undefined;
      // INSECURE-BY-DESIGN: model output returned verbatim, no PAN/CVV/national-ID filtering
      const reply = last ? textOf(last) : "";
      deps.sessions.append(key, human, ...(last ? [last] : []));
      return { reply, sessionId: id };
    },
  };
}
