"""Runs every configuration over every origin and saves the forecasts."""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
from timesfm3 import TimesFM3Forecaster

from app import config
from app.data import snapshot
from app.eval import artifact, experiments, metrics
from app.forecast import baseline, model, windows
from app.forecast.windows import Window
from app.logging_setup import Logger


def _run_configurations(
    forecaster: TimesFM3Forecaster,
    frame: pd.DataFrame,
    built: list[Window],
    truth: np.ndarray,
    baseline_mae: float,
    *,
    log: Logger,
) -> dict[str, dict]:
    """Scores every timesfm configuration, returning a fresh results dict."""
    configuration_results: dict[str, dict] = {}
    for experiment in experiments.EXPERIMENTS:
        if experiment.kind != "timesfm":
            continue
        started = time.perf_counter()
        points, quantiles = model.run_experiment(
            forecaster, frame, built, experiment, log=log
        )
        configuration_results[experiment.name] = {
            "points": points,
            "quantiles": quantiles,
            "scores": metrics.evaluate(points, truth, baseline_mae, quantiles),
        }
        log.info(
            "Running the configuration succeeded.",
            name=experiment.name,
            mae=configuration_results[experiment.name]["scores"]["mae"],
            seconds=time.perf_counter() - started,
        )
    return configuration_results


def run(*, log: Logger) -> None:
    """Runs every configuration over every origin and saves the forecasts."""
    frame = snapshot.load_snapshot(log=log)
    snapshot.validate_snapshot(frame, log=log)
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    log.info(
        "Building the backtest windows succeeded.",
        origins=len(built),
        context_hours=config.CONTEXT_HOURS,
        horizon_hours=config.HORIZON_HOURS,
    )

    naive_points = baseline.seasonal_naive(frame, built)
    baseline_mae = metrics.mae(naive_points, truth)
    log.info("Scoring the baseline succeeded.", mae=baseline_mae)

    results = {
        "seasonal-naive": {
            "points": naive_points,
            "quantiles": np.repeat(
                naive_points[..., None], config.N_QUANTILES, axis=-1
            ),
            "scores": metrics.evaluate(naive_points, truth, baseline_mae),
        }
    }

    forecaster = model.build_forecaster(log=log)
    results.update(
        _run_configurations(forecaster, frame, built, truth, baseline_mae, log=log)
    )

    # A second, short run of the same configuration, for the determinism check.
    repeat, _ = model.run_experiment(
        forecaster,
        frame,
        built[: config.DETERMINISM_ORIGINS],
        experiments.by_name("timesfm-univariate"),
        log=log,
    )
    log.info(
        "Running the determinism repeat succeeded.",
        origins=config.DETERMINISM_ORIGINS,
    )

    artifact.save_artifact(config.FORECASTS_PATH, results, repeat, log=log)
