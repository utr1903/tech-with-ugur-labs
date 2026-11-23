"""Entrypoint: wiring only.

uv run app canary | bench | behaviour
"""

from __future__ import annotations

import argparse
import sys

from app.errors import LabError
from app.logging_setup import configure_logging, install_global_error_handlers

APP_NAME = "tetragon-bench"
COMMANDS = ("canary", "bench", "behaviour")


def run_command(command: str) -> None:
    """Runs one subcommand; each is wired in as its module lands."""
    raise LabError(f"{command} is not implemented")


def main() -> int:
    """Parses argv, dispatches to a command, maps failure to an exit code."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)

    parser = argparse.ArgumentParser(prog="app")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        subparser = subparsers.add_parser(name)
        if name == "bench":
            subparser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()

    try:
        run_command(args.command)
    except LabError:
        log.exception("Command failed.", command=args.command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
