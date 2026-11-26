"""Renders the scoreboard as plain markdown tables."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from app.report.aggregate import ScoredRun, Summary
from app.scoring.msft_score import CellResult

_LIST_CAP = 10
_SUMMARY_HEADER = (
    "| Tool | Question | Runs | Mean | Min | Max | Recall | Precision "
    "| Format failures | Mean wall time | Mean cost | Mean sources |"
)
_RUN_HEADER = (
    "| Tool | Question | Run | Status | Score | Format failure "
    "| Wall time | Cost | Sources |"
)


def render_summary_table(summaries: Iterable[Summary]) -> str:
    """The per-tool, per-question summary as a markdown table."""
    rows = [_SUMMARY_HEADER, _separator(_SUMMARY_HEADER)]
    for s in summaries:
        cells = (
            s.tool,
            s.question_id,
            str(s.runs),
            _percent(s.mean),
            _percent(s.minimum),
            _percent(s.maximum),
            _optional_percent(s.mean_recall),
            _optional_percent(s.mean_precision),
            str(s.format_failures),
            _minutes(s.mean_wall_seconds),
            _cost(s.mean_cost_usd),
            f"{s.mean_sources:.1f}",
        )
        rows.append(_row(cells))
    return "\n".join(rows)


def render_scoreboard(
    summaries: Iterable[Summary],
    scored: Iterable[ScoredRun],
    *,
    generated_on: date,
) -> str:
    """The whole scoreboard document, ending in a newline."""
    runs = list(scored)
    lines = [
        "# Scoreboard",
        "",
        f"Generated on {generated_on.isoformat()} from {len(runs)} run files. "
        "Score (primary = F1 for q1-kev, cell accuracy for q2-msft); "
        "a run that did not complete scores 0.",
        "",
        "## Summary",
        "",
        render_summary_table(summaries),
        "",
        "## Runs",
        "",
        _run_table(runs),
        "",
        "## Where it went wrong",
        "",
    ]
    for item in runs:
        lines.extend(_details(item))
    return "\n".join(lines).rstrip("\n") + "\n"


def _run_table(runs: list[ScoredRun]) -> str:
    rows = [_RUN_HEADER, _separator(_RUN_HEADER)]
    for item in runs:
        r = item.record
        rows.append(
            _row(
                (
                    r.tool,
                    r.question_id,
                    str(r.run),
                    r.status,
                    _percent(item.primary),
                    "yes" if item.format_failure else "no",
                    _minutes(r.wall_seconds),
                    _cost(r.cost_usd),
                    str(len(r.sources)),
                )
            )
        )
    return "\n".join(rows)


def _details(item: ScoredRun) -> list[str]:
    r = item.record
    lines = [f"### {r.tool} {r.question_id} run {r.run}", ""]
    if r.status != "completed":
        lines.append(f"- run did not complete ({r.status})")
    elif item.format_failure:
        lines.append("- no parseable answer block")
    else:
        lines.extend(_problems(item))
    lines.append("")
    return lines


def _problems(item: ScoredRun) -> list[str]:
    lines: list[str] = []
    if item.kev is not None:
        kev = item.kev
        lines += _capped("Missed", sorted(kev.missed))
        lines += _capped("Extra", sorted(kev.extra))
        mismatches = [
            f"{cve} (answered {answered}, truth {expected})"
            for cve, answered, expected in sorted(kev.vendor_mismatches)
        ]
        lines += _capped("Vendor mismatches", mismatches)
    if item.msft is not None:
        wrong = [_cell(c) for c in item.msft.cells if not c.correct]
        lines += _capped("Wrong cells", wrong)
    return lines or ["- nothing wrong"]


def _capped(label: str, items: list[str]) -> list[str]:
    if not items:
        return []
    shown = ", ".join(items[:_LIST_CAP])
    extra = len(items) - _LIST_CAP
    suffix = f", … and {extra} more" if extra > 0 else ""
    return [f"- {label}: {shown}{suffix}"]


def _cell(cell: CellResult) -> str:
    answer = "none" if cell.answer is None else _number(cell.metric, cell.answer)
    expected = _number(cell.metric, cell.truth)
    return f"{cell.quarter_end} {cell.metric}: {answer} vs {expected}"


def _number(metric: str, value: float) -> str:
    if metric == "diluted_eps" or not float(value).is_integer():
        return f"{value:.2f}"
    return f"{value:.0f}"


def _percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def _optional_percent(value: float | None) -> str:
    return "n/a" if value is None else _percent(value)


def _minutes(seconds: float) -> str:
    whole = int(round(seconds))
    return f"{whole // 60}:{whole % 60:02d}"


def _cost(value: float | None) -> str:
    return "n/a" if value is None else f"${value:.2f}"


def _row(cells: tuple[str, ...]) -> str:
    return "| " + " | ".join(cells) + " |"


def _separator(header: str) -> str:
    columns = header.count("|") - 1
    return "|" + "|".join(["---"] * columns) + "|"
