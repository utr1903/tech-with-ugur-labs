import { randomUUID } from "node:crypto";
import type { BaseMessage } from "@langchain/core/messages";

export class SessionStore {
  private sessions = new Map<string, BaseMessage[]>();
  get(id: string): BaseMessage[] { return [...(this.sessions.get(id) ?? [])]; }
  append(id: string, ...m: BaseMessage[]): void {
    this.sessions.set(id, [...(this.sessions.get(id) ?? []), ...m]);
  }
  newId(): string { return randomUUID(); }
}
