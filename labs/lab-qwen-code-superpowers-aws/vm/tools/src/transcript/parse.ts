/**
 * Turns one line of Qwen Code's stream-json output into a TranscriptEvent.
 * Lines the viewer and verifier do not need (block starts, tool argument
 * deltas, progress pings) return null; unreadable lines become "invalid"
 * so a damaged transcript never stops a replay.
 */
import type { ContentBlock, TranscriptEvent } from "./events.js";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/** True when a line's `parent_tool_use_id` marks it as coming from a subagent. */
const isSubagent = (raw: Json): boolean =>
  typeof raw.parent_tool_use_id === "string" &&
  raw.parent_tool_use_id.length > 0;

function parseSystem(raw: Json): TranscriptEvent {
  if (raw.subtype !== "init")
    return { kind: "notice", subtype: str(raw.subtype) };
  const tools = Array.isArray(raw.tools)
    ? raw.tools.filter((t): t is string => typeof t === "string")
    : [];
  return {
    kind: "init",
    sessionId: str(raw.session_id),
    model: str(raw.model),
    cwd: str(raw.cwd),
    tools,
    version: str(raw.qwen_code_version),
  };
}

function parseStreamEvent(raw: Json): TranscriptEvent | null {
  const event = raw.event;
  if (!isRecord(event)) return null;
  if (event.type === "message_start") return { kind: "turn-start" };
  if (event.type === "content_block_stop") return { kind: "block-end" };
  if (event.type === "content_block_delta") {
    const delta = event.delta;
    if (!isRecord(delta)) return null;
    if (delta.type === "text_delta")
      return { kind: "text-delta", text: str(delta.text) };
    if (delta.type === "thinking_delta")
      return { kind: "thinking-delta", text: str(delta.thinking) };
    return null;
  }
  return null;
}

function parseContentBlock(block: unknown): ContentBlock | null {
  if (!isRecord(block)) return null;
  if (block.type === "text") return { type: "text", text: str(block.text) };
  if (block.type === "thinking")
    return { type: "thinking", thinking: str(block.thinking) };
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: str(block.id),
      name: str(block.name),
      input: isRecord(block.input) ? block.input : {},
    };
  }
  return null;
}

function parseAssistant(raw: Json): TranscriptEvent | null {
  const message = raw.message;
  if (!(isRecord(message) && Array.isArray(message.content))) return null;
  const blocks = message.content
    .map(parseContentBlock)
    .filter((b): b is ContentBlock => b !== null);
  return { kind: "assistant", blocks, subagent: isSubagent(raw) };
}

function parseUser(raw: Json): TranscriptEvent | null {
  const message = raw.message;
  if (!(isRecord(message) && Array.isArray(message.content))) return null;
  const block = message.content.find(
    (b): b is Json => isRecord(b) && b.type === "tool_result",
  );
  if (!block) return null;
  return {
    kind: "tool-result",
    toolUseId: str(block.tool_use_id),
    isError: block.is_error === true,
    content: str(block.content),
    subagent: isSubagent(raw),
  };
}

function parseResult(raw: Json): TranscriptEvent {
  const error = raw.error;
  const errorMessage =
    isRecord(error) && typeof error.message === "string" ? error.message : null;
  return {
    kind: "result",
    subtype: str(raw.subtype),
    isError: raw.is_error === true,
    durationMs: num(raw.duration_ms),
    numTurns: num(raw.num_turns),
    text: str(raw.result),
    errorMessage,
  };
}

/** Parses a driver-injected line: a scripted owner reply or the driver's own finish record. Anything else → "unknown". */
function parseDriver(raw: Json): TranscriptEvent {
  if (raw.event === "reply") {
    return {
      kind: "driver-reply",
      round: num(raw.round),
      stage: str(raw.stage),
      message: str(raw.message),
    };
  }
  if (raw.event === "finished") {
    return {
      kind: "driver-finished",
      reason: str(raw.reason),
      rounds: num(raw.rounds),
      exitCode: num(raw.exitCode),
    };
  }
  return { kind: "unknown", type: "driver" };
}

/** Parses one line of the raw transcript into a TranscriptEvent, dispatching on its `type` field; unreadable JSON becomes `{ kind: "invalid" }` rather than throwing. */
export function parseLine(line: string): TranscriptEvent | null {
  if (line.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "invalid" };
  }
  if (!isRecord(raw)) return { kind: "invalid" };
  switch (raw.type) {
    case "system":
      return parseSystem(raw);
    case "stream_event":
      return parseStreamEvent(raw);
    case "assistant":
      return parseAssistant(raw);
    case "user":
      return parseUser(raw);
    case "result":
      return parseResult(raw);
    case "driver":
      return parseDriver(raw);
    default:
      return { kind: "unknown", type: str(raw.type) };
  }
}
