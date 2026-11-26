from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from app.errors import TruthError
from app.truth.edgar import build_msft_truth

_FIXTURE = Path(__file__).parent / "fixtures" / "companyfacts_msft_trimmed.json"


def _facts() -> dict[str, object]:
    loaded: dict[str, object] = json.loads(_FIXTURE.read_text())
    return loaded


def test_fourth_quarter_is_derived_from_annual_minus_nine_months() -> None:
    truth = build_msft_truth(_facts(), quarter_ends=(date(2025, 6, 30),))

    quarter = truth.quarters[0]
    assert quarter.quarter_end == "2025-06-30"
    assert quarter.revenue_usd_millions == 76441.0
    assert quarter.net_income_usd_millions == 27233.0
    assert quarter.diluted_eps_usd == 3.65
    assert quarter.derived is True
    assert truth.cik == "0000789019"


def test_reported_quarter_uses_latest_filed_row() -> None:
    truth = build_msft_truth(_facts(), quarter_ends=(date(2025, 3, 31),))

    quarter = truth.quarters[0]
    assert quarter.revenue_usd_millions == 70066.0
    assert quarter.net_income_usd_millions == 25824.0
    assert quarter.diluted_eps_usd == 3.46
    assert quarter.derived is False


def test_order_follows_requested_quarter_ends() -> None:
    ends = (date(2025, 3, 31), date(2024, 12, 31))
    truth = build_msft_truth(_facts(), quarter_ends=ends)

    assert [q.quarter_end for q in truth.quarters] == ["2025-03-31", "2024-12-31"]


def test_missing_quarter_raises_naming_tag_and_quarter() -> None:
    with pytest.raises(TruthError, match="2026-03-31"):
        build_msft_truth(_facts(), quarter_ends=(date(2026, 3, 31),))


def test_missing_tag_raises() -> None:
    with pytest.raises(TruthError, match="RevenueFromContract"):
        build_msft_truth(
            {"cik": 789019, "facts": {"us-gaap": {}}},
            quarter_ends=(date(2025, 3, 31),),
        )
