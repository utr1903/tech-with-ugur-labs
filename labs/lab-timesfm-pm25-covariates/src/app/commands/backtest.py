"""Runs every configuration over every origin and saves the forecasts."""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
from timesfm3 import TimesFM3Forecaster

from app import config
from app.data import snapshot
from app.eval import artifact, experiments, metrics
from app.eval.results import ExperimentResult
from app.forecast import baseline, model, windows
from app.forecast.windows import Window
from app.lib.arrays import FloatArray
from app.logging_setup import Logger


def _run_configurations(
    forecaster: TimesFM3Forecaster,
    frame: pd.DataFrame,
    built: list[Window],
    truth: FloatArray,
    baseline_mae: float,
    *,
    log: Logger,
) -> dict[str, ExperimentResult]:
    """Scores every timesfm configuration, returning a fresh results dict."""
    configuration_results: dict[str, ExperimentResult] = {}
    for experiment in experiments.EXPERIMENTS:
        if experiment.kind != "timesfm":
            continue
        started = time.perf_counter()
        points, quantiles = model.run_experiment(
            forecaster, frame, built, experiment, log=log
        )
        result = ExperimentResult(
            points=points,
            quantiles=quantiles,
            scores=metrics.evaluate(points, truth, baseline_mae, quantiles),
        )
        configuration_results[experiment.name] = result
        log.info(
            "Scored the configuration.",
            name=experiment.name,
            mae=result.scores.mae,
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
        "Built the backtest windows.",
        origins=len(built),
        context_hours=config.CONTEXT_HOURS,
        horizon_hours=config.HORIZON_HOURS,
    )

    naive_points = baseline.seasonal_naive(frame, built)
    baseline_mae = metrics.mae(naive_points, truth)
    log.info("Scored the baseline.", mae=baseline_mae)

    naive_quantiles: FloatArray = np.repeat(
        naive_points[..., None], config.N_QUANTILES, axis=-1
    )
    results = {
        "seasonal-naive": ExperimentResult(
            points=naive_points,
            quantiles=naive_quantiles,
            scores=metrics.evaluate(naive_points, truth, baseline_mae),
        )
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
        "Ran the determinism repeat.",
        origins=config.DETERMINISM_ORIGINS,
    )

    artifact.save_artifact(config.FORECASTS_PATH, results, repeat, log=log)
