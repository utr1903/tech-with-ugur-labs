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
from app.errors import LabError
from app.logging_setup import configure_logging, install_global_error_handlers

APP_NAME = "timesfm-pm25-covariates"

COMMANDS = {
    "run": run.run,
    "fetch": fetch.run,
    "backtest": backtest.run,
    "report": report.run,
}


def main(argv: list[str] | None = None) -> int:
    """Parses argv, dispatches to a command, maps failure to an exit code."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)

    parser = argparse.ArgumentParser(prog="app", description=__doc__)
    parser.add_argument("command", nargs="?", default="run", choices=list(COMMANDS))
    args = parser.parse_args(argv)

    try:
        COMMANDS[args.command](log=log)
    except LabError:
        log.exception("Command failed.", command=args.command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
