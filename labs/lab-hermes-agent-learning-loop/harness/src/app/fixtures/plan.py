"""Builds the planted truth for a week, deterministically from its seed."""

from __future__ import annotations

import random

from app.errors import FixtureError
from app.fixtures.plan_first import plan_first_week
from app.fixtures.plan_next import plan_next_week
from app.fixtures.plan_types import WeekPlan
from app.fixtures.spec import WEEKS


def plan_week(week: str) -> WeekPlan:
    """Plans `week`; later weeks start from the previous week's plan."""
    if week not in WEEKS:
        raise FixtureError(f"unknown week {week}")
    names = list(WEEKS)
    rng = random.Random(WEEKS[week].seed)
    if names.index(week) == 0:
        return plan_first_week(week, rng)
    return plan_next_week(week, plan_week(names[names.index(week) - 1]), rng)
