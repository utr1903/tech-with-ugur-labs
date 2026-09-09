"""Turning the backtest into something a person can read."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import matplotlib

matplotlib.use("Agg")  # no display inside the container
import matplotlib.pyplot as plt
import numpy as np

import experiments
import labconfig
from windows import Window

_HEADER = f"{'configuration':<22}{'MAE':>8}{'RMSE':>8}{'MASE':>8}{'coverage':>10}  notes"


def format_scoreboard(results: dict[str, dict]) -> str:
    """Renders the metrics table in configuration order."""
    lines = ["", "Scoreboard (PM2.5, ug/m3, 24h ahead)", "-" * len(_HEADER), _HEADER]
    for experiment in experiments.EXPERIMENTS:
        scores = results[experiment.name]["scores"]
        coverage = scores["coverage"]
        coverage_text = "-".rjust(10) if np.isnan(coverage) else f"{coverage:>10.2f}"
        note = experiment.blurb.split(". ")[0].rstrip(".")
        marker = " *" if experiment.leaky else ""
        lines.append(
            f"{experiment.name:<22}"
            f"{scores['mae']:>8.2f}"
            f"{scores['rmse']:>8.2f}"
            f"{scores['mase']:>8.3f}"
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


def worst_episode_index(truth: np.ndarray) -> int:
    """The origin whose horizon contains the highest measured PM2.5."""
    return int(np.argmax(truth.max(axis=1)))


def plot_episode(
    built: Sequence[Window],
    truth: np.ndarray,
    results: dict[str, dict],
    index: int,
    path: Path,
) -> None:
    """Draws one smog episode: measured truth, forecast, and the 0.1-0.9 band."""
    hours = np.arange(labconfig.HORIZON_HOURS)
    origin = built[index].origin

    figure, axes = plt.subplots(figsize=(10, 5.5))

    band = results["timesfm-past-future"]["quantiles"][index]
    axes.fill_between(
        hours,
        band[:, labconfig.LOW_QUANTILE_INDEX],
        band[:, labconfig.HIGH_QUANTILE_INDEX],
        alpha=0.2,
        label="TimesFM 0.1-0.9 band (weather covariates)",
    )

    axes.plot(hours, truth[index], linewidth=2.5, label="measured PM2.5")
    for name, style in (
        ("seasonal-naive", "--"),
        ("timesfm-univariate", "-."),
        ("timesfm-past-future", "-"),
    ):
        axes.plot(
            hours,
            results[name]["points"][index],
            style,
            linewidth=1.6,
            label=name,
        )

    axes.set_title(
        f"Milan PM2.5, 24 hours from {origin:%Y-%m-%d %H:%M} UTC "
        f"(peak {truth[index].max():.0f} ug/m3)"
    )
    axes.set_xlabel("hours after the forecast origin")
    axes.set_ylabel("PM2.5 (ug/m3)")
    axes.legend(loc="best", fontsize=8)
    axes.grid(alpha=0.3)
    figure.tight_layout()

    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=140)
    plt.close(figure)
