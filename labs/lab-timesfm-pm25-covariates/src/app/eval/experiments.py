"""The six things we are comparing.

The split that matters: CO and NO2 are the strongest correlates of PM2.5 in this
dataset (+0.92 and +0.79) and you cannot know either one in advance, so they can
only ever be past-only covariates. The weather correlates less strongly but a
forecast genuinely gives it to you, so it can be past-and-future.
"""

from __future__ import annotations

from dataclasses import dataclass

from app import config
from app.errors import ExperimentError

UNKNOWABLE_POLLUTANTS = ("nitrogen_dioxide", "carbon_monoxide")


@dataclass(frozen=True)
class Experiment:
    """One row of the scoreboard."""

    name: str
    kind: str  # "naive" or "timesfm"
    blurb: str
    past_only: tuple[str, ...] = ()
    past_future: tuple[str, ...] = ()
    leaky: bool = False


EXPERIMENTS: tuple[Experiment, ...] = (
    Experiment(
        name="seasonal-naive",
        kind="naive",
        blurb="Same hour yesterday. No model, no data beyond the target.",
    ),
    Experiment(
        name="timesfm-univariate",
        kind="timesfm",
        blurb="TimesFM on the PM2.5 history alone.",
    ),
    Experiment(
        name="timesfm-past-only",
        kind="timesfm",
        blurb="Plus measured NO2 and CO up to the origin, and no further.",
        past_only=UNKNOWABLE_POLLUTANTS,
    ),
    Experiment(
        name="timesfm-past-future",
        kind="timesfm",
        blurb=(
            "Plus tomorrow's weather, measured rather than forecast. That is "
            "the best case for these covariates, not target leakage - a real "
            "forecast would carry error a measured value does not."
        ),
        past_future=config.WEATHER_VARIABLES,
    ),
    Experiment(
        name="timesfm-both",
        kind="timesfm",
        blurb="Past pollutants and future weather together.",
        past_only=UNKNOWABLE_POLLUTANTS,
        past_future=config.WEATHER_VARIABLES,
    ),
    Experiment(
        name="leaky-control",
        kind="timesfm",
        blurb=(
            "CHEATS. Hands the model tomorrow's NO2 and CO as if they were "
            "forecastable. Nobody can run this for real - it is here to show "
            "what target leakage looks like on a scoreboard."
        ),
        past_future=UNKNOWABLE_POLLUTANTS,
        leaky=True,
    ),
)


def by_name(name: str) -> Experiment:
    """Looks up one configuration."""
    for experiment in EXPERIMENTS:
        if experiment.name == name:
            return experiment
    raise ExperimentError(f"no experiment named {name}")
