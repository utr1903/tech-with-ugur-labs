"""The fixed shape of the mock fleet: services, weeks, seeds."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

SERVICES: tuple[str, ...] = (
    "billing",
    "catalog",
    "checkout",
    "identity",
    "inventory",
    "notifications",
)


@dataclass(frozen=True)
class WeekSpec:
    """One week of fixtures: a seed and the Monday its logs start on."""

    seed: int
    start: date


WEEKS: dict[str, WeekSpec] = {
    "week-1": WeekSpec(seed=20261109, start=date(2026, 11, 9)),
    "week-2": WeekSpec(seed=20261116, start=date(2026, 11, 16)),
}
