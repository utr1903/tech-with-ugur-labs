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
    frame = snapshot.load_snapshot(log=log)
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    results, repeat = artifact.load_artifact(config.FORECASTS_PATH, log=log)

    output.write_line(scoreboard.format_scoreboard(results))

    index = plot.worst_episode_index(truth)
    plot.plot_episode(built, truth, results, index, config.EPISODE_PLOT_PATH, log=log)

    outcomes = checks.run_all(frame, built, results, repeat, log=log)
    output.write_line(checks.format_results(outcomes))
    failed = [outcome for outcome in outcomes if not outcome.passed]
    if failed:
        output.write_line(f"\n{len(failed)} check(s) FAILED")
        raise ChecksFailedError(f"{len(failed)} check(s) failed")
    output.write_line("\nall checks passed")
