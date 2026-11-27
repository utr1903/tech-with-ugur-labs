"""Entrypoint: wiring only.

uv run app fixtures
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable

from app.commands import fixtures as fixtures_command
from app.envvars import load_settings
from app.errors import LabError
from app.logging_setup import Logger, configure_logging, install_global_error_handlers

APP_NAME = "harness"
COMMANDS = ("fixtures", "check", "run", "report", "leak-check")

type Handler = Callable[[argparse.Namespace, Logger], None]


def _fixtures(args: argparse.Namespace, log: Logger) -> None:
    fixtures_command.run(load_settings(os.environ), check=args.check, log=log)


# Later commands register themselves here as they are implemented.
HANDLERS: dict[str, Handler] = {"fixtures": _fixtures}


def build_parser() -> argparse.ArgumentParser:
    """Builds the command-line parser with one subcommand per command."""
    parser = argparse.ArgumentParser(prog="app")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        subparser = subparsers.add_parser(name)
        if name == "fixtures":
            subparser.add_argument("--check", action="store_true")
    return parser


def _resolve(command: str) -> Handler:
    handler = HANDLERS.get(command)
    if handler is None:
        raise LabError(f"command {command} is not implemented yet")
    return handler


def main() -> int:
    """Parses argv, dispatches to a command, maps failure to an exit code."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)

    args = build_parser().parse_args()

    try:
        _resolve(args.command)(args, log)
    except LabError:
        log.exception("Command failed.", command=args.command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
