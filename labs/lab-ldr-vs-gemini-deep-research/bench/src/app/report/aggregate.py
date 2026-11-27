"""Scores every run and summarises them per tool and question."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime

from app.errors import RunStoreError
from app.runs.record import RunRecord
from app.scoring.kev_score import KevScore, score_kev
from app.scoring.msft_score import MsftScore, score_msft
from app.truth.edgar import MsftTruth
from app.truth.kev import KevTruth

_QUESTION_ORDER = ("q1-kev", "q2-msft")
_TOOL_ORDER = ("ldr", "gemini")


@dataclass(frozen=True)
class ScoredRun:
    """One run with its score; runs that did not complete score 0."""

    record: RunRecord
    primary: float
    format_failure: bool
    kev: KevScore | None
    msft: MsftScore | None


@dataclass(frozen=True)
class Summary:
    """Mean, spread and cost of all runs of one tool on one question."""

    tool: str
    question_id: str
    runs: int
    mean: float
    minimum: float
    maximum: float
    mean_recall: float | None
    mean_precision: float | None
    mean_vendor_accuracy: float | None
    mean_mentioned_recall: float | None
    format_failures: int
    mean_wall_seconds: float
    mean_cost_usd: float | None
    mean_sources: float


def score_runs(
    runs: Iterable[RunRecord], kev_truth: KevTruth, msft_truth: MsftTruth
) -> tuple[ScoredRun, ...]:
    """Scores each run against its question's key, in a stable order."""
    ordered = sorted(runs, key=_run_key)
    return tuple(_score(record, kev_truth, msft_truth) for record in ordered)


def summarise(scored: Iterable[ScoredRun]) -> tuple[Summary, ...]:
    """One summary per (question, tool) that has runs, q1 first, ldr first."""
    groups: dict[tuple[str, str], list[ScoredRun]] = {}
    for item in scored:
        key = (item.record.question_id, item.record.tool)
        groups.setdefault(key, []).append(item)
    return tuple(
        _summary(tool, question, groups[(question, tool)])
        for question, tool in sorted(groups, key=_group_key)
    )


def newest_run_date(runs: Iterable[RunRecord]) -> date:
    """The calendar date of the newest `started_at`, so output is reproducible."""
    stamps: list[datetime] = []
    for record in runs:
        try:
            stamps.append(datetime.fromisoformat(record.started_at))
        except ValueError as err:
            raise RunStoreError(
                f"run {record.tool}/{record.question_id}/{record.run} has a bad "
                f"started_at {record.started_at!r}"
            ) from err
    if not stamps:
        raise RunStoreError("no runs to date")
    return max(stamps).date()


def _run_key(record: RunRecord) -> tuple[int, int, int]:
    return (
        _rank(_QUESTION_ORDER, record.question_id),
        _rank(_TOOL_ORDER, record.tool),
        record.run,
    )


def _group_key(group: tuple[str, str]) -> tuple[int, int]:
    question, tool = group
    return (_rank(_QUESTION_ORDER, question), _rank(_TOOL_ORDER, tool))


def _rank(order: tuple[str, ...], value: str) -> int:
    return order.index(value) if value in order else len(order)


def _score(record: RunRecord, kev_truth: KevTruth, msft_truth: MsftTruth) -> ScoredRun:
    if record.question_id not in _QUESTION_ORDER:
        raise RunStoreError(f"unknown question {record.question_id!r}")
    if record.status != "completed":
        return ScoredRun(record, 0.0, True, None, None)
    if record.question_id == "q1-kev":
        kev = score_kev(record.report, kev_truth)
        return ScoredRun(record, kev.primary, kev.format_failure, kev, None)
    msft = score_msft(record.report, msft_truth)
    return ScoredRun(record, msft.primary, msft.format_failure, None, msft)


def _summary(tool: str, question: str, items: list[ScoredRun]) -> Summary:
    primaries = [i.primary for i in items]
    is_kev = question == "q1-kev"
    return Summary(
        tool=tool,
        question_id=question,
        runs=len(items),
        mean=_mean(primaries),
        minimum=min(primaries),
        maximum=max(primaries),
        mean_recall=_kev_mean(items, lambda k: k.recall) if is_kev else None,
        mean_precision=_kev_mean(items, lambda k: k.precision) if is_kev else None,
        mean_vendor_accuracy=(
            _kev_mean(items, lambda k: k.vendor_accuracy) if is_kev else None
        ),
        mean_mentioned_recall=(
            _kev_mean(items, lambda k: k.mentioned_recall) if is_kev else None
        ),
        format_failures=sum(1 for i in items if i.format_failure),
        mean_wall_seconds=_mean([i.record.wall_seconds for i in items]),
        mean_cost_usd=_known_mean([i.record.cost_usd for i in items]),
        mean_sources=_mean([float(len(i.record.sources)) for i in items]),
    )


def _kev_mean(items: list[ScoredRun], pick: Callable[[KevScore], float]) -> float:
    """Mean over all runs; a run with no score counts as 0."""
    return _mean([pick(i.kev) if i.kev else 0.0 for i in items])


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _known_mean(values: list[float | None]) -> float | None:
    known = [v for v in values if v is not None]
    return _mean(known) if known else None
