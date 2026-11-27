"""Estimated spend of a cell, from token counts."""

from __future__ import annotations

# Vertex AI MaaS price for Gemma 4 26B (gemma-4-26b-a4b-it-maas),
# cloud.google.com/vertex-ai/generative-ai/pricing, read 2026-11-27.
# USD per 1M (input, output) tokens.
GEMMA_PRICE_PER_M = (0.15, 0.60)


def cost_usd(input_tokens: int, output_tokens: int) -> float:
    """Estimated USD for the given token counts."""
    price_in, price_out = GEMMA_PRICE_PER_M
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000
