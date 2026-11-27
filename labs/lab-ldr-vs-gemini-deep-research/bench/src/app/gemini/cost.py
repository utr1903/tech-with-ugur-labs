"""What a Gemini run cost, from the token counts the API reports."""

from __future__ import annotations

from collections.abc import Mapping

# Gemini 3.1 Pro preview list price, checked 2026-11-26. USD per 1M tokens:
# input, output (thinking included), cached input. The API reports totals
# summed over the agent's many model calls, while the higher long-context
# rates apply per prompt above 200k tokens; the totals cannot show which
# calls crossed that line, so the base rates give an estimate (a floor).
# Search grounding is not added: it sits inside a free monthly allowance.
_INPUT_RATE, _OUTPUT_RATE, _CACHED_RATE = 2.00, 12.00, 0.20


def gemini_cost_usd(usage: Mapping[str, object]) -> float | None:
    """Cost in USD; thought tokens bill as output. None if no usage came back."""
    if "total_input_tokens" not in usage and "total_output_tokens" not in usage:
        return None
    prompt = _tokens(usage, "total_input_tokens")
    cached = _tokens(usage, "total_cached_tokens")
    output = _tokens(usage, "total_output_tokens") + _tokens(
        usage, "total_thought_tokens"
    )
    return (
        max(prompt - cached, 0) * _INPUT_RATE
        + cached * _CACHED_RATE
        + output * _OUTPUT_RATE
    ) / 1_000_000


def _tokens(usage: Mapping[str, object], key: str) -> int:
    value = usage.get(key)
    return int(value) if isinstance(value, int | float) else 0
