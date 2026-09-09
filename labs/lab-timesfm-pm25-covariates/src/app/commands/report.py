"""Re-renders the scoreboard, plot and checks from a saved backtest."""

from __future__ import annotations

from app import config
from app.commands import plot, scoreboard
from app.data import snapshot
from app.eval import artifact, checks
from app.forecast import windows


def run() -> int:
    """Re-renders the scoreboard, plot and checks from a saved backtest."""
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    results, repeat = artifact.load_artifact(config.FORECASTS_PATH)

    print(scoreboard.format_scoreboard(results))

    index = plot.worst_episode_index(truth)
    plot.plot_episode(built, truth, results, index, config.EPISODE_PLOT_PATH)
    print(f"\nwrote {config.EPISODE_PLOT_PATH}")

    outcomes = checks.run_all(frame, built, results, repeat)
    print(checks.format_results(outcomes))
    failed = [o for o in outcomes if not o.passed]
    if failed:
        print(f"\n{len(failed)} check(s) FAILED")
        return 1
    print("\nall checks passed")
    return 0
