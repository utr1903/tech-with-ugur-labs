"""Runs every configuration over every origin and saves the forecasts."""

from __future__ import annotations

import time

import numpy as np

from app import config
from app.data import snapshot
from app.eval import artifact, experiments, metrics
from app.forecast import baseline, model, windows


def run() -> int:
    """Runs every configuration over every origin and saves the forecasts."""
    frame = snapshot.load_snapshot()
    snapshot.validate_snapshot(frame)
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    print(f"{len(built)} origins, {config.CONTEXT_HOURS}h context, "
          f"{config.HORIZON_HOURS}h horizon")

    naive_points = baseline.seasonal_naive(frame, built)
    baseline_mae = metrics.mae(naive_points, truth)
    print(f"seasonal-naive MAE: {baseline_mae:.2f} ug/m3")

    results = {
        "seasonal-naive": {
            "points": naive_points,
            "quantiles": np.repeat(
                naive_points[..., None], config.N_QUANTILES, axis=-1
            ),
            "scores": metrics.evaluate(naive_points, truth, baseline_mae),
        }
    }

    forecaster = model.build_forecaster()
    for experiment in experiments.EXPERIMENTS:
        if experiment.kind != "timesfm":
            continue
        started = time.perf_counter()
        points, quantiles = model.run_experiment(forecaster, frame, built, experiment)
        results[experiment.name] = {
            "points": points,
            "quantiles": quantiles,
            "scores": metrics.evaluate(points, truth, baseline_mae, quantiles),
        }
        print(
            f"{experiment.name:<22} MAE {results[experiment.name]['scores']['mae']:>6.2f}"
            f"  ({time.perf_counter() - started:.0f}s)"
        )

    # A second, short run of the same configuration, for the determinism check.
    repeat, _ = model.run_experiment(
        forecaster,
        frame,
        built[: config.DETERMINISM_ORIGINS],
        experiments.by_name("timesfm-univariate"),
    )

    artifact.save_artifact(config.FORECASTS_PATH, results, repeat)
    print(f"saved forecasts to {config.FORECASTS_PATH}")
    return 0
