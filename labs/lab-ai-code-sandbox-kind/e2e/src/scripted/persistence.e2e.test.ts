import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CAFE_PROBLEM } from "../support/cafe.js";
import { loadHistory, sendChat } from "../support/chat-client.js";
import { restartDeployment, WEB_URL } from "../support/cluster.js";
import { waitForHttp } from "../support/port-forward.js";

describe("persistence", () => {
  it("restores identical history after the server pod restarts and keeps threads apart", async () => {
    const threadA = randomUUID();
    await sendChat(threadA, CAFE_PROBLEM);
    const before = await loadHistory(threadA);

    expect(before.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(before[0]?.parts).toEqual([{ type: "text", text: CAFE_PROBLEM }]);
    const toolPart = before[1]?.parts.find((p) => p.type === "dynamic-tool");
    expect(toolPart).toMatchObject({
      toolName: "code_executor",
      state: "output-available",
    });
    const input = toolPart?.input as { code?: string } | undefined;
    expect(input?.code).toContain("np.linalg.solve");
    const textPart = before[1]?.parts.find((p) => p.type === "text");
    expect(String(textPart?.text)).toContain("### Solution");

    await restartDeployment("server");
    await waitForHttp(`${WEB_URL}/api/tools`);
    const after = await loadHistory(threadA);
    expect(after).toEqual(before);

    const threadB = randomUUID();
    const questionB = "Second thread: what do the café items cost?";
    await sendChat(threadB, questionB);
    const historyB = await loadHistory(threadB);
    expect(historyB.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(historyB[0]?.parts).toEqual([{ type: "text", text: questionB }]);
    const idsA = new Set(after.map((m) => m.id));
    expect(historyB.some((m) => idsA.has(m.id))).toBe(false);
    expect(JSON.stringify(historyB)).not.toContain(CAFE_PROBLEM);
    expect(await loadHistory(threadA)).toEqual(before);
  });
});
