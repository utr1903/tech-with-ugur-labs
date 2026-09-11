"""Thin command-line wiring and domain exit-code mapping."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.commands.run import run
from app.errors import LabError, NoIncumbentError, ScenarioError, VerificationError
from app.logging_setup import configure_logging, install_global_error_handlers


def main() -> int:
    log = configure_logging(app_name="manufacturing-profit")
    install_global_error_handlers(log)
    parser = argparse.ArgumentParser(
        description="Solve scenario.yaml and write verified reports to output/."
    )
    parser.add_argument(
        "--scenario",
        type=Path,
        default=Path("scenario.yaml"),
        help="input YAML (default: scenario.yaml)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output"),
        help="artifact directory (default: output/)",
    )
    parser.add_argument(
        "--time-limit",
        type=float,
        default=None,
        help="seconds; omitted preserves YAML setting",
    )
    parser.add_argument(
        "--gap",
        type=float,
        default=None,
        help="relative gap; omitted preserves YAML setting",
    )
    args = parser.parse_args()
    try:
        run(
            args.scenario,
            args.output,
            time_limit_seconds=args.time_limit,
            relative_gap=args.gap,
            log=log,
        )
    except LabError as err:
        log.exception("Command failed.", scenario=str(args.scenario))
        if isinstance(err, ScenarioError):
            return 2
        if isinstance(err, NoIncumbentError):
            return 3
        if isinstance(err, VerificationError):
            return 4
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
