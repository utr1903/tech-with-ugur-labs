"""Scores a report's quarterly figures against the EDGAR answer key."""

from __future__ import annotations

from dataclasses import dataclass

from app.answers.msft_answer import QuarterRow, parse_msft_answer
from app.truth.edgar import MsftTruth, QuarterTruth


@dataclass(frozen=True)
class CellResult:
    """One (quarter, metric) cell: the answered value, the truth, and the verdict."""

    quarter_end: str
    metric: str
    answer: float | None
    truth: float
    correct: bool


@dataclass(frozen=True)
class MsftScore:
    """Share of truth cells answered within tolerance."""

    format_failure: bool
    cell_accuracy: float
    cells: tuple[CellResult, ...]

    @property
    def primary(self) -> float:
        """The headline number for this question."""
        return self.cell_accuracy


def score_msft(report: str, truth: MsftTruth, *, tolerance: float = 0.005) -> MsftScore:
    """Checks every truth cell against the answered row for the same quarter."""
    rows = parse_msft_answer(report)
    by_quarter: dict[str, QuarterRow] = {}
    for answered in rows or ():
        by_quarter.setdefault(answered.quarter_end, answered)

    cells: list[CellResult] = []
    for quarter in truth.quarters:
        row = by_quarter.get(quarter.quarter_end)
        for metric, answer, expected in _metrics(quarter, row):
            cells.append(
                CellResult(
                    quarter_end=quarter.quarter_end,
                    metric=metric,
                    answer=answer,
                    truth=expected,
                    correct=_within(answer, expected, tolerance),
                )
            )
    correct = sum(1 for cell in cells if cell.correct)
    accuracy = correct / len(cells) if cells else 0.0
    return MsftScore(rows is None, accuracy, tuple(cells))


def _metrics(
    quarter: QuarterTruth, row: QuarterRow | None
) -> tuple[tuple[str, float | None, float], ...]:
    return (
        (
            "revenue",
            row.revenue_usd_millions if row else None,
            quarter.revenue_usd_millions,
        ),
        (
            "net_income",
            row.net_income_usd_millions if row else None,
            quarter.net_income_usd_millions,
        ),
        ("diluted_eps", row.diluted_eps_usd if row else None, quarter.diluted_eps_usd),
    )


def _within(answer: float | None, truth: float, tolerance: float) -> bool:
    if answer is None:
        return False
    return abs(answer - truth) <= tolerance * abs(truth)
