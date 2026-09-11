"""Turning the backtest into something a person can read."""

from __future__ import annotations

import numpy as np

from app.eval import experiments
from app.eval.results import ExperimentResult

_HEADER = (
    f"{'configuration':<22}{'MAE':>8}{'RMSE':>8}{'MASE':>8}{'coverage':>10}  notes"
)


def format_scoreboard(results: dict[str, ExperimentResult]) -> str:
    """Renders the metrics table in configuration order."""
    lines = ["", "Scoreboard (PM2.5, ug/m3, 24h ahead)", "-" * len(_HEADER), _HEADER]
    for experiment in experiments.EXPERIMENTS:
        scores = results[experiment.name].scores
        coverage = scores.coverage
        coverage_text = "-".rjust(10) if np.isnan(coverage) else f"{coverage:>10.2f}"
        note = experiment.blurb.split(". ")[0].rstrip(".")
        marker = " *" if experiment.leaky else ""
        lines.append(
            f"{experiment.name:<22}"
            f"{scores.mae:>8.2f}"
            f"{scores.rmse:>8.2f}"
            f"{scores.mase:>8.3f}"
            f"{coverage_text}"
            f"  {note}{marker}"
        )
    lines.append("")
    lines.append("MASE is MAE relative to seasonal-naive: below 1.0 beats it.")
    lines.append(
        "* leaky-control is given tomorrow's NO2 and CO. Its score is what "
        "target leakage looks like, not a result."
    )
    return "\n".join(lines)
