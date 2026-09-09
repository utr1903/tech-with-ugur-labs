"""Re-renders the scoreboard, plot and checks from a saved backtest."""

from __future__ import annotations

from app import config, output
from app.commands import plot, scoreboard
from app.data import snapshot
from app.errors import ChecksFailedError
from app.eval import artifact, checks
from app.forecast import windows
from app.logging_setup import Logger


def run(*, log: Logger) -> None:
    """Re-renders the scoreboard, plot and checks from a saved backtest."""
    try:
        log.info("Loading the snapshot...", path=str(config.SNAPSHOT_PATH))
        frame = snapshot.load_snapshot()
    except Exception:
        log.exception("Loading the snapshot failed.", path=str(config.SNAPSHOT_PATH))
        raise
    else:
        log.info("Loading the snapshot succeeded.", rows=len(frame))

    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)

    try:
        log.info("Loading the forecasts...", path=str(config.FORECASTS_PATH))
        results, repeat = artifact.load_artifact(config.FORECASTS_PATH)
    except Exception:
        log.exception(
            "Loading the forecasts failed.", path=str(config.FORECASTS_PATH)
        )
        raise
    else:
        log.info(
            "Loading the forecasts succeeded.", configurations=len(results)
        )

    output.write_line(scoreboard.format_scoreboard(results))

    index = plot.worst_episode_index(truth)
    try:
        log.info("Plotting the worst episode...", path=str(config.EPISODE_PLOT_PATH))
        plot.plot_episode(built, truth, results, index, config.EPISODE_PLOT_PATH)
    except Exception:
        log.exception(
            "Plotting the worst episode failed.", path=str(config.EPISODE_PLOT_PATH)
        )
        raise
    else:
        log.info(
            "Plotting the worst episode succeeded.", path=str(config.EPISODE_PLOT_PATH)
        )

    try:
        log.info("Running the checks...", origins=len(built))
        outcomes = checks.run_all(frame, built, results, repeat)
    except Exception:
        log.exception("Running the checks failed.", origins=len(built))
        raise
    else:
        log.info(
            "Running the checks succeeded.",
            passed=sum(outcome.passed for outcome in outcomes),
            total=len(outcomes),
        )

    output.write_line(checks.format_results(outcomes))
    failed = [outcome for outcome in outcomes if not outcome.passed]
    if failed:
        output.write_line(f"\n{len(failed)} check(s) FAILED")
        raise ChecksFailedError(f"{len(failed)} check(s) failed")
    output.write_line("\nall checks passed")
