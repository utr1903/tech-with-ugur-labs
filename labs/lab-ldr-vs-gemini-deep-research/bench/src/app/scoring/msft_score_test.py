from __future__ import annotations

import json

from app.scoring.msft_score import score_msft
from app.truth.edgar import MsftTruth, QuarterTruth

_TRUTH = MsftTruth(
    cik="0000789019",
    quarters=(
        QuarterTruth("2025-03-31", 70066.0, 25824.0, 3.46, False),
        QuarterTruth("2025-06-30", 76441.0, 27233.0, 3.65, False),
    ),
)


def _row(quarter: str, revenue: float, income: float, eps: float) -> dict[str, object]:
    return {
        "quarter_end": quarter,
        "revenue_usd_millions": revenue,
        "net_income_usd_millions": income,
        "diluted_eps_usd": eps,
    }


def _report(rows: list[dict[str, object]]) -> str:
    return "```json\n" + json.dumps({"quarters": rows}) + "\n```"


def _exact() -> list[dict[str, object]]:
    return [
        _row("2025-03-31", 70066, 25824, 3.46),
        _row("2025-06-30", 76441, 27233, 3.65),
    ]


def test_exact_answer() -> None:
    score = score_msft(_report(_exact()), _TRUTH)
    assert not score.format_failure
    assert score.cell_accuracy == 1.0
    assert score.primary == 1.0
    assert len(score.cells) == 6
    assert {c.metric for c in score.cells} == {"revenue", "net_income", "diluted_eps"}


def test_revenue_tolerance_boundary() -> None:
    rows = _exact()
    rows[0]["revenue_usd_millions"] = 70066 * 1.004
    rows[1]["revenue_usd_millions"] = 76441 * 1.006
    score = score_msft(_report(rows), _TRUTH)
    revenue = {c.quarter_end: c.correct for c in score.cells if c.metric == "revenue"}
    assert revenue == {"2025-03-31": True, "2025-06-30": False}
    assert score.cell_accuracy == 5 / 6


def test_missing_quarter_cells_wrong() -> None:
    score = score_msft(_report(_exact()[:1]), _TRUTH)
    missing = [c for c in score.cells if c.quarter_end == "2025-06-30"]
    assert len(missing) == 3
    assert all(c.answer is None and not c.correct for c in missing)
    assert score.cell_accuracy == 0.5


def test_extra_quarter_ignored() -> None:
    rows = [*_exact(), _row("2025-09-30", 1, 1, 1)]
    score = score_msft(_report(rows), _TRUTH)
    assert score.cell_accuracy == 1.0
    assert len(score.cells) == 6


def test_timestamped_quarter_not_matched() -> None:
    rows = _exact()
    rows[1]["quarter_end"] = "2025-06-30T00:00"
    score = score_msft(_report(rows), _TRUTH)
    assert score.cell_accuracy == 0.5


def test_eps_within_tolerance() -> None:
    rows = _exact()
    rows[1]["diluted_eps_usd"] = 3.64
    assert score_msft(_report(rows), _TRUTH).cell_accuracy == 1.0


def test_malformed_is_format_failure() -> None:
    score = score_msft("no block", _TRUTH)
    assert score.format_failure
    assert score.cell_accuracy == 0.0
    assert len(score.cells) == 6
    assert all(c.answer is None and not c.correct for c in score.cells)
