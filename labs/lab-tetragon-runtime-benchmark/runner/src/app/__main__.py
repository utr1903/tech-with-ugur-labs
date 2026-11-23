"""Entrypoint: wiring only.

uv run app canary | bench | behaviour
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import cast

from app.bench.model import Profile
from app.commands import bench as bench_command
from app.commands import canary as canary_command
from app.errors import LabError
from app.logging_setup import Logger, configure_logging, install_global_error_handlers

APP_NAME = "tetragon-bench"
COMMANDS = ("canary", "bench", "behaviour")


PROFILES = ("default", "tuned", "enforce")


def run_command(args: argparse.Namespace, log: Logger) -> None:
    """Dispatches one subcommand; behaviour is wired in as its module lands."""
    if args.command == "canary":
        canary_command.run(log=log)
    elif args.command == "bench":
        names = [n for n in args.profiles.split(",") if n]
        unknown = [n for n in names if n not in PROFILES]
        if unknown:
            raise LabError(f"unknown profile(s): {unknown}")
        bench_command.run(
            root=Path(args.root),
            runs=args.runs,
            window_s=args.window,
            profiles=cast(list[Profile], names),
            results_dir=Path(args.results or Path(args.root) / "results"),
            only=[p for p in args.only.split(",") if p],
            log=log,
        )
    else:
        raise LabError(f"{args.command} is not implemented")


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
            subparser.add_argument("--window", type=float, default=5.0)
            subparser.add_argument("--profiles", default=",".join(PROFILES))
            subparser.add_argument("--results", default=None)
            subparser.add_argument("--root", default=str(bench_command.LAB_ROOT))
            subparser.add_argument("--only", default="")
    args = parser.parse_args()

    try:
        run_command(args, log)
    except LabError:
        log.exception("Command failed.", command=args.command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
