"""The `fixtures` command: write the fleet and answer keys, or check them."""

from __future__ import annotations

from app.envvars import Settings
from app.errors import FixtureError
from app.fixtures.writer import check_fixtures, write_fixtures
from app.logging_setup import Logger
from app.output import write_line


def run(settings: Settings, *, check: bool, log: Logger) -> None:
    """Generates fixtures into the data dir; with `check`, only compares."""
    if not check:
        count = write_fixtures(settings.data_dir, log=log)
        write_line(f"Wrote {count} fixture files to {settings.data_dir}")
        return
    differing = check_fixtures(settings.data_dir, log=log)
    if differing:
        raise FixtureError(f"{len(differing)} fixture files differ: {differing[:5]}")
    write_line("Fixtures match the generator.")
