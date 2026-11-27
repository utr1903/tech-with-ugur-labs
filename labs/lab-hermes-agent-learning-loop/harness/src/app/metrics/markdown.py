"""Renders the matrix summary as `results/metrics.md`."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from app.cells.record import CellRecord
from app.metrics.aggregate import TOOLS, CellSummary, latest
from app.metrics.sections import went_wrong, wrote
from app.scoring.score import CATEGORIES

HEADER = (
    "cell",
    "runs",
    "F1",
    "total tok",
    "parent tok",
    "children tok",
    "subagents",
    *TOOLS,
    "wall s",
    "learning path",
    "learning overhead tok",
    "est. USD",
)


def span(mean: float, low: float, high: float, runs: int, digits: int = 0) -> str:
    """`mean` for one run, `mean (min–max)` for repeats."""
    if runs == 1:
        return f"{mean:.{digits}f}"
    return f"{mean:.{digits}f} ({low:.{digits}f}–{high:.{digits}f})"


def table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    """A GitHub markdown table."""
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return lines


def _row(s: CellSummary) -> list[str]:
    low, high = s.total_tokens_range
    wlow, whigh = s.wall_range
    return [
        s.cell,
        str(s.runs),
        span(s.f1_mean, s.f1_min, s.f1_max, s.runs, 2),
        span(s.total_tokens_mean, low, high, s.runs),
        f"{s.parent_tokens_mean:.0f}",
        f"{s.children_tokens_mean:.0f}",
        f"{s.subagents_mean:.1f}",
        *(f"{s.tool_means[t]:.1f}" for t in TOOLS),
        span(s.wall_mean, wlow, whigh, s.runs, 1),
        ", ".join(s.learning_paths),
        f"{s.overhead_tokens_mean:.0f}",
        f"{s.cost_mean_usd:.4f}",
    ]


def _span_lines(records: list[CellRecord]) -> list[str]:
    dates = sorted(r.started_at[:10] for r in records)
    models = ", ".join(sorted({r.model for r in records}))
    versions = ", ".join(sorted({r.hermes_version for r in records}))
    return [
        f"Runs: {dates[0]} to {dates[-1]}" if dates else "Runs: none",
        f"Model: {models}",
        f"Hermes version: {versions}",
    ]


def render(
    summaries: list[CellSummary], records: list[CellRecord], results: Path
) -> str:
    """The whole report as markdown; the same input gives the same text."""
    lines = ["# Matrix results", "", *_span_lines(records), ""]
    lines += ["## Cost and tools", "", *table(HEADER, [_row(s) for s in summaries])]
    lines += [
        "",
        "Repeats show `mean (min–max)`; tool columns are mean calls per run "
        "(main turn, parent plus subagents). `total tok` is the main turn, "
        "parent plus subagents; `learning overhead tok` is the follow-up turn "
        "plus the background reviews.",
        "",
        "`est. USD` covers the main turn (parent and subagents), the follow-up "
        "turn (parent and subagents) and the background review tokens, at "
        "0.15 / 0.60 USD per 1M input / output tokens.",
        "",
        "## F1 per finding category",
        "",
    ]
    cat_rows = [
        [s.cell, *(f"{s.category_f1_mean[c]:.2f}" for c in CATEGORIES)]
        for s in summaries
    ]
    lines += table(("cell", *CATEGORIES), cat_rows)
    lines += ["", *went_wrong([latest(records, s.cell) for s in summaries])]
    lines += ["", *wrote(records, results)]
    lines += [
        "",
        "Warm versus cold is reported as measured; with few repeats a "
        "difference may be noise.",
        "",
    ]
    return "\n".join(lines)
