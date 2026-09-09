"""What does knowing tomorrow's weather buy a time-series foundation model?

    uv run app run        # backtest + report + checks (the default)
    uv run app fetch      # rebuild the data snapshot from Open-Meteo
    uv run app backtest   # forecasts only, saved to output/forecasts.npz
    uv run app report     # re-render from a saved backtest
"""

from __future__ import annotations

import argparse
import sys

from app.commands import backtest, fetch, report, run

COMMANDS = {
    "run": run.run,
    "fetch": fetch.run,
    "backtest": backtest.run,
    "report": report.run,
}


def main(argv: list[str] | None = None) -> int:
    """Parses argv and dispatches to a command."""
    parser = argparse.ArgumentParser(prog="app", description=__doc__)
    parser.add_argument(
        "command", nargs="?", default="run", choices=list(COMMANDS)
    )
    args = parser.parse_args(argv)
    return COMMANDS[args.command]()


if __name__ == "__main__":
    sys.exit(main())
