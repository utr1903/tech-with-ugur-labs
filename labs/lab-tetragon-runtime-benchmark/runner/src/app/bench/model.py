"""Per-run observations and their aggregates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

type Profile = Literal["default", "tuned", "enforce"]


@dataclass(frozen=True)
class Attribution:
    """What one run's event stream says about one scenario."""

    detected: bool
    latency_ms: float | None
    enforcement_seen: bool


@dataclass(frozen=True)
class RunResult:
    """The outcome of one scenario run under one profile."""

    scenario_id: str
    profile: Profile
    run_index: int
    detected: bool
    latency_ms: float | None
    enforcement_seen: bool
    side_effect: bool


@dataclass(frozen=True)
class Summary:
    """All runs of one scenario under one profile, aggregated."""

    scenario_id: str
    profile: Profile
    runs: int
    detected: int
    blocked: int
    median_latency_ms: float | None
    enforcement_events: int
    side_effect_ok: int
    note: str | None
