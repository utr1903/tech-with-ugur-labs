"""Command-line wiring and the mapping from a domain failure to an exit code.

Nothing here decides anything about portfolios. It configures logging once,
parses four arguments, dispatches the one command, and turns each named
failure into the exit code the README documents.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.commands.run import run
from app.errors import InfeasibleError, LabError, ScenarioError, VerificationError
from app.logging_setup import configure_logging, install_global_error_handlers
from app.market import MODES

APP_NAME = "hedge-fund-cvar"

DEFAULT_SCENARIO = Path("scenario.yaml")
DEFAULT_OUTPUT = Path("output")

# Every deliberate failure a run can end on, and what the shell sees. The
# order matters: `LabError` is the base of the other three, so the
# specific cases are tested first.
EXIT_CODES: tuple[tuple[type[LabError], int], ...] = (
    (ScenarioError, 2),
    (InfeasibleError, 3),
    (VerificationError, 4),
    (LabError, 1),
)


def exit_code(err: LabError) -> int:
    """Return the exit code for one failed run."""
    for kind, code in EXIT_CODES:
        if isinstance(err, kind):
            return code
    return 1


def _parser() -> argparse.ArgumentParser:
    """Build the argument parser for the one command this application has."""
    parser = argparse.ArgumentParser(
        prog="app",
        description=(
            "Choose a long/short book that minimizes conditional value at "
            "risk, check it independently, and write the results to output/."
        ),
    )
    parser.add_argument(
        "--scenario",
        type=Path,
        default=DEFAULT_SCENARIO,
        help=f"input YAML (default: {DEFAULT_SCENARIO})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"artifact directory (default: {DEFAULT_OUTPUT}/)",
    )
    parser.add_argument(
        "--mode",
        choices=MODES,
        default=None,
        help="market mode; omitted preserves the scenario's own",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="in-sample seed; omitted preserves the scenario's own",
    )
    return parser


def main() -> int:
    """Parse the command line, run once, and map a failure to its exit code."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)
    args = _parser().parse_args()
    try:
        run(args.scenario, args.output, mode=args.mode, seed=args.seed, log=log)
    except LabError as err:
        log.exception("Command failed.", scenario=str(args.scenario))
        return exit_code(err)
    return 0


if __name__ == "__main__":
    sys.exit(main())
