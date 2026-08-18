const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/g;
const THINK_CLOSE_TAG = "</think>";

// qwen3:4b sometimes leaks its internal reasoning into a final message as
// <think>...</think>, or — when the opening tag is truncated away — as
// reasoning text ending in a stray </think> with no opener. Strip both so
// downstream consumers never see the model's internal monologue.
export function stripThinkBlocks(text: string): string {
  const withoutClosedBlocks = text.replace(THINK_BLOCK_PATTERN, "");
  const lastCloseIndex = withoutClosedBlocks.lastIndexOf(THINK_CLOSE_TAG);
  const withoutLeadingReasoning =
    lastCloseIndex === -1
      ? withoutClosedBlocks
      : withoutClosedBlocks.slice(lastCloseIndex + THINK_CLOSE_TAG.length);
  return withoutLeadingReasoning.trim();
}
