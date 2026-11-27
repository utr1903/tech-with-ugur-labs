from __future__ import annotations

import json

import pytest

from app.answers.kev_answer import KevItem
from app.errors import RunStoreError
from app.report.aggregate import newest_run_date, score_runs, summarise
from app.runs.record import RunRecord
from app.truth.edgar import MsftTruth, QuarterTruth
from app.truth.kev import KevTruth

_KEV = KevTruth(
    window_start="2026-10-01",
    window_end="2026-10-31",
    catalog_version="v",
    entries=(
        KevItem("CVE-2026-0001", "Cisco", "IOS"),
        KevItem("CVE-2026-0002", "Apache", "Tomcat"),
    ),
)
_MSFT = MsftTruth(
    cik="0000789019",
    quarters=(QuarterTruth("2025-06-30", 76441.0, 27233.0, 3.65, False),),
)


def _kev_report(*cves: str) -> str:
    items = [{"cve_id": c, "vendor": "Cisco", "product": "x"} for c in cves]
    return "```json\n" + json.dumps({"cves": items}) + "\n```"


def _record(
    *,
    tool: str = "ldr",
    qid: str = "q1-kev",
    run: int = 1,
    status: str = "completed",
    report: str = "",
    cost: float | None = None,
    wall: float = 60.0,
    sources: tuple[str, ...] = (),
    started: str = "2026-11-01T10:00:00Z",
) -> RunRecord:
    return RunRecord(
        tool=tool,
        question_id=qid,
        run=run,
        started_at=started,
        wall_seconds=wall,
        status=status,
        report=report,
        sources=sources,
        usage={},
        cost_usd=cost,
        meta={},
    )


def test_mean_min_max_over_two_runs() -> None:
    runs = (
        _record(run=1, report=_kev_report("CVE-2026-0001", "CVE-2026-0002")),
        _record(run=2, report=_kev_report("CVE-2026-0001")),
    )

    (summary,) = summarise(score_runs(runs, _KEV, _MSFT))

    assert summary.runs == 2
    assert summary.minimum == pytest.approx(2 / 3)
    assert summary.maximum == 1.0
    assert summary.mean == pytest.approx((1.0 + 2 / 3) / 2)
    assert summary.mean_recall == 0.75
    assert summary.mean_precision == 1.0
    assert summary.format_failures == 0


def test_failed_run_counts_as_zero_and_format_failure() -> None:
    runs = (
        _record(run=1, report=_kev_report("CVE-2026-0001", "CVE-2026-0002")),
        _record(run=2, status="failed"),
    )

    scored = score_runs(runs, _KEV, _MSFT)
    (summary,) = summarise(scored)

    assert scored[1].primary == 0.0
    assert scored[1].format_failure
    assert scored[1].kev is None
    assert summary.mean == 0.5
    assert summary.minimum == 0.0
    assert summary.format_failures == 1
    assert summary.mean_recall == 0.5


def test_gap_numbered_runs_aggregate() -> None:
    runs = (
        _record(run=1, report=_kev_report("CVE-2026-0001", "CVE-2026-0002")),
        _record(run=3, report=_kev_report("CVE-2026-0001", "CVE-2026-0002")),
    )

    (summary,) = summarise(score_runs(runs, _KEV, _MSFT))

    assert summary.runs == 2


def test_summaries_ordered_question_then_tool() -> None:
    runs = (
        _record(tool="gemini", qid="q2-msft"),
        _record(tool="gemini", qid="q1-kev"),
        _record(tool="ldr", qid="q2-msft"),
        _record(tool="ldr", qid="q1-kev"),
    )

    summaries = summarise(score_runs(runs, _KEV, _MSFT))

    assert [(s.question_id, s.tool) for s in summaries] == [
        ("q1-kev", "ldr"),
        ("q1-kev", "gemini"),
        ("q2-msft", "ldr"),
        ("q2-msft", "gemini"),
    ]


def test_msft_has_no_recall_and_cost_averages_known_values() -> None:
    runs = (
        _record(tool="gemini", qid="q2-msft", run=1, cost=1.0, sources=("a", "b")),
        _record(tool="gemini", qid="q2-msft", run=2, cost=None, sources=("a",)),
    )

    (summary,) = summarise(score_runs(runs, _KEV, _MSFT))

    assert summary.mean_recall is None
    assert summary.mean_precision is None
    assert summary.mean_cost_usd == 1.0
    assert summary.mean_sources == 1.5
    assert summary.format_failures == 2


def test_no_cost_anywhere_is_none() -> None:
    (summary,) = summarise(score_runs((_record(),), _KEV, _MSFT))

    assert summary.mean_cost_usd is None


def test_unknown_question_is_run_store_error() -> None:
    with pytest.raises(RunStoreError, match="q9"):
        score_runs((_record(qid="q9"),), _KEV, _MSFT)


def test_newest_run_date() -> None:
    runs = (
        _record(started="2026-11-01T23:00:00Z"),
        _record(run=2, started="2026-11-03T01:00:00Z"),
    )

    assert newest_run_date(runs).isoformat() == "2026-11-03"


def test_newest_run_date_rejects_bad_timestamp() -> None:
    with pytest.raises(RunStoreError):
        newest_run_date((_record(started="yesterday"),))
