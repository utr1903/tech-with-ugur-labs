"""Generates one week of fleet files, byte-for-byte from the week's seed."""

from __future__ import annotations

import random
from pathlib import PurePosixPath

from app.fixtures.files import render_advisories, render_config, render_lock
from app.fixtures.logs import render_access_log
from app.fixtures.plan import plan_week
from app.fixtures.runbook import RUNBOOK_MD
from app.fixtures.spec import SERVICES, WEEKS, WeekSpec

__all__ = ["SERVICES", "WEEKS", "WeekSpec", "generate_week"]

# Keeps the log stream apart from the planting stream of the same seed.
_LOG_SEED_OFFSET = 1_000_003


def generate_week(week: str) -> dict[PurePosixPath, bytes]:
    """Maps each relative file path of the week to its exact bytes."""
    spec = WEEKS[week]
    plan = plan_week(week)
    rng = random.Random(spec.seed + _LOG_SEED_OFFSET)
    files = {
        PurePosixPath("RUNBOOK.md"): RUNBOOK_MD.encode(),
        PurePosixPath("advisories.json"): render_advisories(plan.advisories),
    }
    for service in plan.services:
        base = PurePosixPath("services") / service.name
        files[base / "access.log"] = render_access_log(service, spec.start, rng)
        files[base / "config.yaml"] = render_config(service, rng)
        files[base / "requirements.lock"] = render_lock(service)
    return files
