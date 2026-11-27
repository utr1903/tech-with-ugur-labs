"""Entrypoint: wiring only.

uv run app fixtures
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections.abc import Callable

from app.cells.names import CELLS
from app.commands import assert_e2e as assert_e2e_command
from app.commands import check as check_command
from app.commands import fixtures as fixtures_command
from app.commands import leak_check as leak_check_command
from app.commands import report as report_command
from app.commands import run as run_command
from app.envvars import load_settings
from app.errors import LabError
from app.hermes.client import HermesClient
from app.logging_setup import Logger, configure_logging, install_global_error_handlers

APP_NAME = "harness"
COMMANDS = ("fixtures", "check", "run", "report", "assert-e2e", "leak-check")

type Handler = Callable[[argparse.Namespace, Logger], None]


def _repeat_label(value: str) -> str:
    if not re.fullmatch(r"r\d+", value):
        raise argparse.ArgumentTypeError(f"{value!r} is not of the form rN")
    return value


def _fixtures(args: argparse.Namespace, log: Logger) -> None:
    fixtures_command.run(load_settings(os.environ), check=args.check, log=log)


def _run(args: argparse.Namespace, log: Logger) -> None:
    settings = load_settings(os.environ)
    client = HermesClient(settings.hermes_url, settings.api_key, log=log)
    run_command.run(
        settings,
        run_command.RunArgs(
            args.cell,
            args.week,
            args.home,
            args.follow_up_if_no_skill,
            args.repeat_label,
        ),
        client=client,
        log=log,
    )


def _check(args: argparse.Namespace, log: Logger) -> None:
    settings = load_settings(os.environ)
    client = HermesClient(settings.hermes_url, settings.api_key, log=log)
    check_command.run(
        settings,
        client,
        home_name=args.home,
        expected_model=settings.hermes_model,
        log=log,
    )


def _report(_args: argparse.Namespace, log: Logger) -> None:
    report_command.run(load_settings(os.environ), log=log)


def _assert_e2e(args: argparse.Namespace, log: Logger) -> None:
    assert_e2e_command.run(
        load_settings(os.environ), f1_threshold=args.f1_threshold, log=log
    )


def _leak_check(_args: argparse.Namespace, log: Logger) -> None:
    leak_check_command.run(load_settings(os.environ), log=log)


HANDLERS: dict[str, Handler] = {
    "fixtures": _fixtures,
    "check": _check,
    "run": _run,
    "report": _report,
    "assert-e2e": _assert_e2e,
    "leak-check": _leak_check,
}


def build_parser() -> argparse.ArgumentParser:
    """Builds the command-line parser with one subcommand per command."""
    parser = argparse.ArgumentParser(prog="app")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        subparser = subparsers.add_parser(name)
        if name == "fixtures":
            subparser.add_argument("--check", action="store_true")
        if name == "check":
            subparser.add_argument("--home", required=True)
        if name == "assert-e2e":
            subparser.add_argument("--f1-threshold", type=float, default=0.8)
        if name == "run":
            subparser.add_argument("--cell", required=True, choices=CELLS)
            subparser.add_argument("--week", required=True)
            subparser.add_argument("--home", required=True)
            subparser.add_argument("--follow-up-if-no-skill", action="store_true")
            subparser.add_argument("--repeat-label", default=None, type=_repeat_label)
    return parser


def main() -> int:
    """Parses argv, dispatches to a command, maps failure to an exit code."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)

    args = build_parser().parse_args()

    try:
        HANDLERS[args.command](args, log)
    except LabError:
        log.exception("Command failed.", command=args.command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
