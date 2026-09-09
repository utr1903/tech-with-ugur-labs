"""What does knowing tomorrow's weather buy a time-series foundation model?

    python main.py run        # backtest + report + checks (the default)
    python main.py fetch      # rebuild the data snapshot from Open-Meteo
    python main.py backtest   # forecasts only, saved to output/forecasts.npz
    python main.py report     # re-render from a saved backtest
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

import baseline
import checks
import experiments
import forecast
import labconfig
import metrics
import openmeteo
import report
import snapshot
import windows


def save_artifact(path: Path, results: dict, repeat: np.ndarray) -> None:
    """Persists forecasts, quantiles and scores to one npz file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    arrays: dict[str, np.ndarray] = {"__determinism_repeat__": repeat}
    scores = {}
    for name, result in results.items():
        arrays[f"{name}::points"] = result["points"]
        arrays[f"{name}::quantiles"] = result["quantiles"]
        scores[name] = result["scores"]
    arrays["__scores__"] = np.array(json.dumps(scores))
    np.savez_compressed(path, **arrays)


def load_artifact(path: Path) -> tuple[dict, np.ndarray]:
    """Reads back what save_artifact wrote."""
    with np.load(path, allow_pickle=False) as data:
        scores = json.loads(str(data["__scores__"]))
        repeat = data["__determinism_repeat__"]
        results = {
            name: {
                "points": data[f"{name}::points"],
                "quantiles": data[f"{name}::quantiles"],
                "scores": scores[name],
            }
            for name in scores
        }
    return results, repeat


def fetch() -> int:
    """Rebuilds the committed snapshot from the live endpoints."""
    print(f"fetching {labconfig.FETCH_START}..{labconfig.FETCH_END} for Milan")
    frame = openmeteo.fetch_snapshot()
    openmeteo.write_snapshot(frame, labconfig.SNAPSHOT_PATH)
    print(f"wrote {len(frame)} rows to {labconfig.SNAPSHOT_PATH}")
    return 0


def backtest() -> int:
    """Runs every configuration over every origin and saves the forecasts."""
    frame = snapshot.load_snapshot()
    snapshot.validate_snapshot(frame)
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    print(f"{len(built)} origins, {labconfig.CONTEXT_HOURS}h context, "
          f"{labconfig.HORIZON_HOURS}h horizon")

    naive_points = baseline.seasonal_naive(frame, built)
    baseline_mae = metrics.mae(naive_points, truth)
    print(f"seasonal-naive MAE: {baseline_mae:.2f} ug/m3")

    results = {
        "seasonal-naive": {
            "points": naive_points,
            "quantiles": np.repeat(
                naive_points[..., None], labconfig.N_QUANTILES, axis=-1
            ),
            "scores": metrics.evaluate(naive_points, truth, baseline_mae),
        }
    }

    model = forecast.build_forecaster()
    for experiment in experiments.EXPERIMENTS:
        if experiment.kind != "timesfm":
            continue
        started = time.perf_counter()
        points, quantiles = forecast.run_experiment(model, frame, built, experiment)
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
    repeat, _ = forecast.run_experiment(
        model,
        frame,
        built[: labconfig.DETERMINISM_ORIGINS],
        experiments.by_name("timesfm-univariate"),
    )

    save_artifact(labconfig.FORECASTS_PATH, results, repeat)
    print(f"saved forecasts to {labconfig.FORECASTS_PATH}")
    return 0


def report_only() -> int:
    """Re-renders the scoreboard, plot and checks from a saved backtest."""
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    results, repeat = load_artifact(labconfig.FORECASTS_PATH)

    print(report.format_scoreboard(results))

    index = report.worst_episode_index(truth)
    report.plot_episode(built, truth, results, index, labconfig.EPISODE_PLOT_PATH)
    print(f"\nwrote {labconfig.EPISODE_PLOT_PATH}")

    outcomes = checks.run_all(frame, built, truth, results, repeat)
    print(checks.format_results(outcomes))
    failed = [o for o in outcomes if not o.passed]
    if failed:
        print(f"\n{len(failed)} check(s) FAILED")
        return 1
    print("\nall checks passed")
    return 0


def run() -> int:
    """The default: backtest, then report."""
    code = backtest()
    return code or report_only()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        nargs="?",
        default="run",
        choices=["run", "fetch", "backtest", "report"],
    )
    args = parser.parse_args(argv)
    return {
        "run": run,
        "fetch": fetch,
        "backtest": backtest,
        "report": report_only,
    }[args.command]()


if __name__ == "__main__":
    sys.exit(main())
