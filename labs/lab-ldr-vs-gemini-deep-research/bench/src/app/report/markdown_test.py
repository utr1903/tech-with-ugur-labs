from __future__ import annotations

import json
from datetime import date

from app.answers.kev_answer import KevItem
from app.report.aggregate import ScoredRun, score_runs, summarise
from app.report.markdown import render_scoreboard, render_summary_table
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


def _record(
    qid: str, report: str, *, run: int = 1, status: str = "completed"
) -> RunRecord:
    return RunRecord(
        tool="ldr",
        question_id=qid,
        run=run,
        started_at="2026-11-01T10:00:00Z",
        wall_seconds=125.4,
        status=status,
        report=report,
        sources=("a",),
        usage={},
        cost_usd=1.5,
        meta={},
    )


def _kev(*items: tuple[str, str]) -> str:
    rows = [{"cve_id": c, "vendor": v, "product": "x"} for c, v in items]
    return "```json\n" + json.dumps({"cves": rows}) + "\n```"


def _msft(eps: float) -> str:
    row = {
        "quarter_end": "2025-06-30",
        "revenue_usd_millions": 76441,
        "net_income_usd_millions": 27233,
        "diluted_eps_usd": eps,
    }
    return "```json\n" + json.dumps({"quarters": [row]}) + "\n```"


def _render(runs: tuple[RunRecord, ...]) -> str:
    scored = score_runs(runs, _KEV, _MSFT)
    return render_scoreboard(summarise(scored), scored, generated_on=date(2026, 11, 1))


def test_has_sections_and_summary_header() -> None:
    text = _render((_record("q1-kev", _kev(("CVE-2026-0001", "Cisco"))),))

    assert text.startswith("# Scoreboard")
    assert "primary = F1 for q1-kev, cell accuracy for q2-msft" in text
    assert "| Tool | Question | Runs | Mean | Min | Max |" in text
    assert "## Where it went wrong" in text
    assert "2026-11-01" in text


def test_summary_row_formats() -> None:
    text = _render((_record("q1-kev", _kev(("CVE-2026-0001", "Cisco"))),))

    assert "| ldr | q1-kev | 1 | 66.7% |" in text
    assert "2:05" in text
    assert "$1.50" in text


def test_cost_not_available() -> None:
    record = _record("q2-msft", _msft(3.65))
    record = RunRecord(**{**record.__dict__, "cost_usd": None})
    scored = score_runs((record,), _KEV, _MSFT)

    assert "n/a" in render_summary_table(summarise(scored))


def test_wrong_cell_line() -> None:
    text = _render((_record("q2-msft", _msft(3.80)),))

    assert "2025-06-30 diluted_eps: 3.80 vs 3.65" in text
    assert "revenue: 76441" not in text


def test_missing_answer_cell() -> None:
    text = _render((_record("q2-msft", "no block"),))

    assert "no parseable answer block" in text


def test_kev_details() -> None:
    text = _render(
        (_record("q1-kev", _kev(("CVE-2026-0001", "Wrong"), ("CVE-2026-9999", "X"))),)
    )

    assert "Missed: CVE-2026-0002" in text
    assert "Extra: CVE-2026-9999" in text
    assert "CVE-2026-0001 (answered Wrong, truth Cisco)" in text


def test_failed_run_explained() -> None:
    text = _render((_record("q1-kev", "", status="timeout"),))

    assert "run did not complete (timeout)" in text


def test_format_failure_never_implies_nothing_missed() -> None:
    text = _render((_record("q1-kev", "prose only"),))

    assert "no parseable answer block" in text
    assert "Missed" not in text


def test_lists_are_capped() -> None:
    truth = KevTruth(
        "a",
        "b",
        "v",
        tuple(KevItem(f"CVE-2026-{i:04d}", "V", "p") for i in range(1, 26)),
    )
    runs = (_record("q1-kev", _kev(("CVE-2026-0001", "V"))),)
    scored = score_runs(runs, truth, _MSFT)

    text = render_scoreboard(summarise(scored), scored, generated_on=date(2026, 11, 1))

    assert "CVE-2026-0012" not in text
    assert "and 14 more" in text


def test_deterministic_regardless_of_input_order() -> None:
    a = _record("q1-kev", _kev(("CVE-2026-0001", "Cisco")), run=1)
    b = _record("q1-kev", _kev(("CVE-2026-0002", "Apache")), run=2)

    assert _render((a, b)) == _render((b, a))


def test_summary_table_alone() -> None:
    scored: tuple[ScoredRun, ...] = score_runs((_record("q1-kev", ""),), _KEV, _MSFT)

    table = render_summary_table(summarise(scored))

    assert table.splitlines()[0].startswith("| Tool |")
    assert "Where it went wrong" not in table
