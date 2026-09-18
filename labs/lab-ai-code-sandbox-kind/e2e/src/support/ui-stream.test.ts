import { describe, expect, it } from "vitest";
import {
  assistantText,
  parseSse,
  toolInputs,
  toolOutputs,
} from "./ui-stream.js";

const sse = [
  'data: {"type":"start"}',
  "",
  'data: {"type":"tool-input-available","toolCallId":"c1","toolName":"code_executor","input":{"code":"print(1)"},"dynamic":true}',
  "",
  'data: {"type":"tool-output-available","toolCallId":"c1","output":"{\\"status\\":\\"succeeded\\"}"}',
  "",
  'data: {"type":"text-delta","id":"t","delta":"### Mod"}',
  'data: {"type":"text-delta","id":"t","delta":"el"}',
  "data: [DONE]",
  "",
].join("\n");

describe("ui stream parsing", () => {
  it("extracts tool inputs, parsed tool outputs and the assistant text", () => {
    const chunks = parseSse(sse);
    expect(toolInputs(chunks)).toEqual([
      {
        toolCallId: "c1",
        toolName: "code_executor",
        input: { code: "print(1)" },
      },
    ]);
    expect(toolOutputs(chunks)).toEqual([
      { toolCallId: "c1", output: { status: "succeeded" } },
    ]);
    expect(assistantText(chunks)).toBe("### Model");
  });
});
