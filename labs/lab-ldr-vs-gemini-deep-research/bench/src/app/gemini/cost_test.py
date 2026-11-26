from __future__ import annotations

import pytest

from app.gemini.cost import gemini_cost_usd


def test_long_context_rates_split_cached_input() -> None:
    usage = {
        "total_input_tokens": 250_000,
        "total_cached_tokens": 150_000,
        "total_output_tokens": 60_000,
        "total_thought_tokens": 0,
    }

    assert gemini_cost_usd(usage) == pytest.approx(1.54)


def test_short_context_rates_bill_thoughts_as_output() -> None:
    usage = {
        "total_input_tokens": 100_000,
        "total_cached_tokens": 40_000,
        "total_output_tokens": 10_000,
        "total_thought_tokens": 5_000,
    }

    expected = 60_000 * 2 / 1e6 + 40_000 * 0.2 / 1e6 + 15_000 * 12 / 1e6
    assert gemini_cost_usd(usage) == pytest.approx(expected)


def test_missing_usage_has_no_cost() -> None:
    assert gemini_cost_usd({}) is None


def test_absent_cached_and_thought_tokens_count_as_zero() -> None:
    usage = {"total_input_tokens": 100_000, "total_output_tokens": 100_000}

    assert gemini_cost_usd(usage) == pytest.approx(0.2 + 1.2)
