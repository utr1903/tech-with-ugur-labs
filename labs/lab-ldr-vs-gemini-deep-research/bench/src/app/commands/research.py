"""The `research` command."""

from __future__ import annotations

import argparse

from app.errors import ConfigError
from app.logging_setup import Logger


def run(args: argparse.Namespace, *, log: Logger) -> None:
    """Runs the `research` command."""
    log.warning("Command is not implemented.", command=args.command)
    raise ConfigError("not implemented")
