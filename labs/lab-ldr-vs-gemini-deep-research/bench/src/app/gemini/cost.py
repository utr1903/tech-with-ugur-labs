"""What a Gemini run cost, from the token counts the API reports."""

from __future__ import annotations

from collections.abc import Mapping

# Gemini 3.1 Pro preview list price, checked 2026-11-26. USD per 1M tokens.
# Prompts above the threshold are billed at the higher long-context rates.
# Search grounding is not added: it sits inside a free monthly allowance.
_LONG_CONTEXT_THRESHOLD = 200_000
_SHORT_RATES = (2.00, 12.00, 0.20)
_LONG_RATES = (4.00, 18.00, 0.40)


def gemini_cost_usd(usage: Mapping[str, object]) -> float | None:
    """Cost in USD; thought tokens bill as output. None if no usage came back."""
    if "total_input_tokens" not in usage and "total_output_tokens" not in usage:
        return None
    prompt = _tokens(usage, "total_input_tokens")
    cached = _tokens(usage, "total_cached_tokens")
    output = _tokens(usage, "total_output_tokens") + _tokens(
        usage, "total_thought_tokens"
    )
    input_rate, output_rate, cached_rate = (
        _LONG_RATES if prompt > _LONG_CONTEXT_THRESHOLD else _SHORT_RATES
    )
    return (
        max(prompt - cached, 0) * input_rate
        + cached * cached_rate
        + output * output_rate
    ) / 1_000_000


def _tokens(usage: Mapping[str, object], key: str) -> int:
    value = usage.get(key)
    return int(value) if isinstance(value, int | float) else 0
