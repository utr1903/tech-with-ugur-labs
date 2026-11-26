"""Entrypoint: wiring only.

uv run app score
"""

from __future__ import annotations

import argparse
import sys

from app.commands import check, frontier, research, score, truth
from app.errors import LabError
from app.logging_setup import configure_logging, install_global_error_handlers

APP_NAME = "bench"
QUESTIONS = ("q1-kev", "q2-msft", "all")
DEFAULT_RUNS = 3


def _add_research_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--question", choices=QUESTIONS, default="all")
    parser.add_argument("--runs", type=int, default=DEFAULT_RUNS)
    parser.add_argument("--overwrite", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    """Builds the command-line parser with one subcommand per command."""
    parser = argparse.ArgumentParser(prog="app")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("truth").add_argument("--check", action="store_true")
    _add_research_options(commands.add_parser("research"))
    _add_research_options(commands.add_parser("frontier"))
    commands.add_parser("score")
    commands.add_parser("check")
    return parser


def main() -> int:
    """Parses argv, dispatches to a command, maps failure to an exit code."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)

    args = build_parser().parse_args()
    handlers = {
        "truth": truth,
        "research": research,
        "frontier": frontier,
        "score": score,
        "check": check,
    }

    try:
        handlers[args.command].run(args, log=log)
    except LabError:
        log.exception("Command failed.", command=args.command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
