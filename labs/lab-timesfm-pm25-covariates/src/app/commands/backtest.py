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


def _load_snapshot(*, log: Logger) -> pd.DataFrame:
    try:
        log.info("Loading the snapshot...", path=str(config.SNAPSHOT_PATH))
        frame = snapshot.load_snapshot()
    except Exception:
        log.exception("Loading the snapshot failed.", path=str(config.SNAPSHOT_PATH))
        raise
    else:
        log.info("Loading the snapshot succeeded.", rows=len(frame))
        return frame


def _validate_snapshot(frame: pd.DataFrame, *, log: Logger) -> None:
    try:
        log.info("Validating the snapshot...", rows=len(frame))
        snapshot.validate_snapshot(frame)
    except Exception:
        log.exception("Validating the snapshot failed.", rows=len(frame))
        raise
    else:
        log.info("Validating the snapshot succeeded.", rows=len(frame))


def _build_forecaster(*, log: Logger) -> TimesFM3Forecaster:
    try:
        log.info("Building the forecaster...", batch_size=config.BATCH_SIZE)
        forecaster = model.build_forecaster()
    except Exception:
        log.exception("Building the forecaster failed.", batch_size=config.BATCH_SIZE)
        raise
    else:
        log.info("Building the forecaster succeeded.", checkpoint=config.CHECKPOINT)
        return forecaster


def _run_configurations(
    forecaster: TimesFM3Forecaster,
    frame: pd.DataFrame,
    built: list[Window],
    truth: np.ndarray,
    baseline_mae: float,
    results: dict[str, dict],
    *,
    log: Logger,
) -> None:
    for experiment in experiments.EXPERIMENTS:
        if experiment.kind != "timesfm":
            continue
        started = time.perf_counter()
        try:
            log.info("Running the configuration...", name=experiment.name)
            points, quantiles = model.run_experiment(
                forecaster, frame, built, experiment
            )
        except Exception:
            log.exception("Running the configuration failed.", name=experiment.name)
            raise
        else:
            results[experiment.name] = {
                "points": points,
                "quantiles": quantiles,
                "scores": metrics.evaluate(points, truth, baseline_mae, quantiles),
            }
            log.info(
                "Running the configuration succeeded.",
                name=experiment.name,
                mae=results[experiment.name]["scores"]["mae"],
                seconds=time.perf_counter() - started,
            )


def _run_determinism_repeat(
    forecaster: TimesFM3Forecaster,
    frame: pd.DataFrame,
    built: list[Window],
    *,
    log: Logger,
) -> np.ndarray:
    try:
        log.info(
            "Running the determinism repeat...", origins=config.DETERMINISM_ORIGINS
        )
        repeat, _ = model.run_experiment(
            forecaster,
            frame,
            built[: config.DETERMINISM_ORIGINS],
            experiments.by_name("timesfm-univariate"),
        )
    except Exception:
        log.exception(
            "Running the determinism repeat failed.",
            origins=config.DETERMINISM_ORIGINS,
        )
        raise
    else:
        log.info(
            "Running the determinism repeat succeeded.",
            origins=config.DETERMINISM_ORIGINS,
        )
        return repeat


def _save_forecasts(
    results: dict[str, dict], repeat: np.ndarray, *, log: Logger
) -> None:
    try:
        log.info("Saving the forecasts...", path=str(config.FORECASTS_PATH))
        artifact.save_artifact(config.FORECASTS_PATH, results, repeat)
    except Exception:
        log.exception("Saving the forecasts failed.", path=str(config.FORECASTS_PATH))
        raise
    else:
        log.info("Saving the forecasts succeeded.", path=str(config.FORECASTS_PATH))


def run(*, log: Logger) -> None:
    """Runs every configuration over every origin and saves the forecasts."""
    frame = _load_snapshot(log=log)
    _validate_snapshot(frame, log=log)
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

    forecaster = _build_forecaster(log=log)
    _run_configurations(
        forecaster, frame, built, truth, baseline_mae, results, log=log
    )
    repeat = _run_determinism_repeat(forecaster, frame, built, log=log)
    _save_forecasts(results, repeat, log=log)
