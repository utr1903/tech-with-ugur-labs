"""Plans the first week from scratch."""

from __future__ import annotations

import random

from app.fixtures.catalog import ADVISORIES, ADVISORY_COUNT_BY_WEEK, PACKAGES
from app.fixtures.config_rules import RISKY_FLAGS
from app.fixtures.plan_types import ServicePlan, WeekPlan
from app.fixtures.spec import SERVICES

MAX_PER_SERVICE = 2
LOG_LINES_RANGE = (1500, 1900)
type IpPlan = dict[str, tuple[tuple[str, ...], tuple[str, ...], str]]


def plan_ips(rng: random.Random) -> IpPlan:
    """Per service: brute-force IPs, probe IPs, and one 19-failure decoy."""
    slots = [
        (s, kind, n) for s in SERVICES for kind, n in (("b", 0), ("b", 1), ("p", 0))
    ]
    chosen = sorted(rng.sample(slots, rng.randint(6, 12)), key=slots.index)
    hosts = iter(rng.sample(range(1, 255), len(chosen) + len(SERVICES)))
    brute: dict[str, list[str]] = {s: [] for s in SERVICES}
    probe: dict[str, list[str]] = {s: [] for s in SERVICES}
    for service, kind, _ in chosen:
        (brute if kind == "b" else probe)[service].append(f"203.0.113.{next(hosts)}")
    return {
        s: (tuple(brute[s]), tuple(probe[s]), f"203.0.113.{next(hosts)}")
        for s in SERVICES
    }


def plan_flags(rng: random.Random) -> dict[str, tuple[str, ...]]:
    """4-8 risky flags, at most two per service, one service left clean."""
    eligible = rng.sample(SERVICES, len(SERVICES) - 1)
    planted: dict[str, set[str]] = {s: set() for s in SERVICES}
    for _ in range(rng.randint(4, 8)):
        service = rng.choice([s for s in eligible if len(planted[s]) < MAX_PER_SERVICE])
        planted[service].add(rng.choice(sorted(set(RISKY_FLAGS) - planted[service])))
    return {s: tuple(sorted(planted[s])) for s in SERVICES}


def _pick_vulnerable(rng: random.Random) -> dict[str, list[str]]:
    advisory_packages = [
        a.package for a in ADVISORIES[: ADVISORY_COUNT_BY_WEEK["week-1"]]
    ]
    picked: dict[str, list[str]] = {s: [] for s in SERVICES}
    for _ in range(rng.randint(4, 7)):
        service = rng.choice([s for s in SERVICES if len(picked[s]) < MAX_PER_SERVICE])
        picked[service].append(
            rng.choice([p for p in advisory_packages if p not in picked[service]])
        )
    return picked


def plan_locks(
    rng: random.Random,
) -> dict[str, tuple[dict[str, str], tuple[tuple[str, str, str], ...]]]:
    """Per service: pinned versions and the vulnerable pins among them."""
    picked = _pick_vulnerable(rng)
    ids = {a.package: a.id for a in ADVISORIES}
    pending_service = rng.choice(SERVICES)  # paramiko gets its advisory in week 2
    result = {}
    for service in SERVICES:
        pins = {pkg: rng.choice(PACKAGES[pkg].affected) for pkg in picked[service]}
        if service == pending_service:
            pins["paramiko"] = rng.choice(PACKAGES["paramiko"].affected)
        rest = sorted(set(PACKAGES) - set(pins))
        for pkg in rng.sample(rest, max(0, rng.randint(6, 10) - len(pins))):
            pins[pkg] = rng.choice(PACKAGES[pkg].safe)
        found = tuple((pkg, pins[pkg], ids[pkg]) for pkg in sorted(picked[service]))
        result[service] = (pins, found)
    return result


def plan_first_week(week: str, rng: random.Random) -> WeekPlan:
    """Plants week one's findings from the seeded generator."""
    ips, flags, locks = plan_ips(rng), plan_flags(rng), plan_locks(rng)
    services = tuple(
        ServicePlan(
            name=s,
            brute_ips=ips[s][0],
            probe_ips=ips[s][1],
            decoy_ip=ips[s][2],
            flags=flags[s],
            packages=tuple(sorted(locks[s][0].items())),
            vulnerable=locks[s][1],
            log_lines=rng.randint(*LOG_LINES_RANGE),
        )
        for s in SERVICES
    )
    return WeekPlan(week, services, ADVISORIES[: ADVISORY_COUNT_BY_WEEK[week]])
