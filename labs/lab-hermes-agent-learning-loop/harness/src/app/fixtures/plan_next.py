"""Plans a later week as a change set on top of the previous one."""

from __future__ import annotations

import dataclasses
import random

from app.errors import FixtureError
from app.fixtures.catalog import ADVISORIES, ADVISORY_COUNT_BY_WEEK, PACKAGES
from app.fixtures.config_rules import RISKY_FLAGS
from app.fixtures.plan_first import LOG_LINES_RANGE, MAX_PER_SERVICE, plan_ips
from app.fixtures.plan_types import ServicePlan, WeekPlan


def _flip_flags(rng: random.Random, flags: dict[str, set[str]]) -> dict[str, set[str]]:
    """Clears one flag and sets another elsewhere; a clean service stays."""
    present = sorted((s, f) for s, found in flags.items() for f in found)
    service, flag = rng.choice(present)
    flags[service].discard(flag)
    options = sorted(
        (s, f)
        for s, found in flags.items()
        if found and len(found) < MAX_PER_SERVICE
        for f in RISKY_FLAGS
        if f not in found and (s, f) != (service, flag)
    )
    if not options:
        raise FixtureError("no service can take another risky flag")
    target, new_flag = rng.choice(options)
    flags[target].add(new_flag)
    return flags


def _bump_versions(
    rng: random.Random, plans: tuple[ServicePlan, ...], count: int
) -> dict[str, dict[str, str]]:
    """One vulnerable pin moves out of its range, one safe pin moves in."""
    pins = {p.name: dict(p.packages) for p in plans}
    covered = {a.package for a in ADVISORIES[:count]}
    fixed_up = rng.choice(sorted((p.name, v[0]) for p in plans for v in p.vulnerable))
    pins[fixed_up[0]][fixed_up[1]] = rng.choice(PACKAGES[fixed_up[1]].safe)
    vulnerable_now = {(p.name, v[0]) for p in plans for v in p.vulnerable}
    candidates = sorted(
        (p.name, pkg)
        for p in plans
        for pkg, _ in p.packages
        if pkg in covered and (p.name, pkg) not in vulnerable_now
    )
    broken = rng.choice(candidates)
    pins[broken[0]][broken[1]] = rng.choice(PACKAGES[broken[1]].affected)
    return pins


def _vulnerable_under(
    pins: dict[str, str], advisory_count: int
) -> tuple[tuple[str, str, str], ...]:
    found = [
        (a.package, pins[a.package], a.id)
        for a in ADVISORIES[:advisory_count]
        if a.package in pins and pins[a.package] in PACKAGES[a.package].affected
    ]
    return tuple(sorted(found))


def plan_next_week(week: str, previous: WeekPlan, rng: random.Random) -> WeekPlan:
    """Same services; re-rolled IPs, one flag flipped, two pins changed."""
    count = ADVISORY_COUNT_BY_WEEK[week]
    ips = plan_ips(rng)
    flags = _flip_flags(rng, {p.name: set(p.flags) for p in previous.services})
    pins = _bump_versions(rng, previous.services, count - 1)
    services = tuple(
        ServicePlan(
            name=p.name,
            brute_ips=ips[p.name][0],
            probe_ips=ips[p.name][1],
            decoy_ip=ips[p.name][2],
            flags=tuple(sorted(flags[p.name])),
            packages=tuple(sorted(pins[p.name].items())),
            vulnerable=_vulnerable_under(pins[p.name], count),
            log_lines=rng.randint(*LOG_LINES_RANGE),
        )
        for p in previous.services
    )
    return dataclasses.replace(
        previous, week=week, services=services, advisories=ADVISORIES[:count]
    )
