"""Drawing the worst smog episode from a backtest."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

from app import config
from app.forecast.windows import Window
from app.logging_setup import Logger


def worst_episode_index(truth: np.ndarray) -> int:
    """The origin whose horizon contains the highest measured PM2.5."""
    return int(np.argmax(truth.max(axis=1)))


def plot_episode(
    built: Sequence[Window],
    truth: np.ndarray,
    results: dict[str, dict],
    index: int,
    path: Path,
    *,
    log: Logger,
) -> None:
    """Draws one smog episode: measured truth, forecast, and the 0.1-0.9 band."""
    try:
        log.info("Plotting the worst episode...", path=str(path))
        hours = np.arange(config.HORIZON_HOURS)
        origin = built[index].origin

        figure, axes = plt.subplots(figsize=(10, 5.5))

        band = results["timesfm-past-future"]["quantiles"][index]
        axes.fill_between(
            hours,
            band[:, config.LOW_QUANTILE_INDEX],
            band[:, config.HIGH_QUANTILE_INDEX],
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
    except Exception:
        log.exception("Plotting the worst episode failed.", path=str(path))
        raise
    else:
        log.info("Plotting the worst episode succeeded.", path=str(path))
