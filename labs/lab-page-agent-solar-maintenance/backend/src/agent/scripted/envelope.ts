export type AgentAction =
  | { click_element_by_index: { index: number } }
  | { input_text: { index: number; text: string } }
  | { select_dropdown_option: { index: number; text: string } }
  | { done: { text: string; success: boolean } };

let callCounter = 0;

/**
 * The exact shape page-agent's OpenAI client demands: finish_reason
 * "tool_calls", one tool call named AgentOutput, arguments as a JSON string.
 */
export function agentOutput(
  model: string,
  nextGoal: string,
  action: AgentAction,
): unknown {
  return {
    id: `chatcmpl-scripted-${++callCounter}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${callCounter}`,
              type: "function",
              function: {
                name: "AgentOutput",
                arguments: JSON.stringify({ next_goal: nextGoal, action }),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
