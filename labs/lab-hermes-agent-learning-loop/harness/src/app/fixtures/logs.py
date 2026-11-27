"""Renders a service's nginx access log, planted findings included."""

from __future__ import annotations

import random
from datetime import UTC, date, datetime, timedelta

from app.fixtures.plan_types import ServicePlan
from app.fixtures.rules import PROBE_PATHS

WEEK_SECONDS = 7 * 24 * 3600
BENIGN_PATHS = (
    "/",
    "/api/orders",
    "/api/items",
    "/api/session",
    "/static/app.js",
    "/static/app.css",
    "/healthz",
    "/favicon.ico",
)
DECOY_PATHS = ("/.envoy/healthz", "/environment", "/.git/config.bak")
USER_AGENTS = (
    "Mozilla/5.0 (X11; Linux x86_64)",
    "Mozilla/5.0 (Macintosh)",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "kube-probe/1.29",
)
BENIGN_STATUSES = (
    (200,) * 70
    + (304,) * 10
    + (301,) * 4
    + (404,) * 8
    + (500,) * 2
    + (
        401,
        403,
    )
)
BENIGN_POOLS = ("198.51.100", "192.0.2")
AUTH_PATHS = ("/login", "/api/session", "/admin")

type Event = tuple[int, str, str, int]


def _benign_events(rng: random.Random, count: int) -> list[Event]:
    events: list[Event] = []
    for _ in range(count):
        ip = f"{rng.choice(BENIGN_POOLS)}.{rng.randint(1, 254)}"
        path = rng.choice(BENIGN_PATHS + DECOY_PATHS * 2)
        if path == "/static/app.js":
            path += f"?v={rng.randint(1, 9)}"
        events.append(
            (rng.randrange(WEEK_SECONDS), ip, path, rng.choice(BENIGN_STATUSES))
        )
    return events


def _burst(
    rng: random.Random, ip: str, count: int, paths: tuple[str, ...]
) -> list[Event]:
    start = rng.randrange(WEEK_SECONDS - 3600)
    return [
        (start + rng.randrange(1800), ip, rng.choice(paths), rng.choice((401, 403)))
        for _ in range(count)
    ]


def _planted_events(rng: random.Random, plan: ServicePlan) -> list[Event]:
    events: list[Event] = []
    for ip in plan.brute_ips:
        events += _burst(rng, ip, rng.randint(20, 35), AUTH_PATHS)
    for ip in plan.probe_ips:
        start = rng.randrange(WEEK_SECONDS - 3600)
        for _ in range(rng.randint(3, 6)):
            path = rng.choice(PROBE_PATHS)
            path += rng.choice(("", "", "?x=1"))
            events.append((start + rng.randrange(900), ip, path, 404))
    start = rng.randrange(WEEK_SECONDS - 3600)
    events += [
        (start + rng.randrange(1800), plan.decoy_ip, "/login", 401) for _ in range(19)
    ]
    return events


def render_access_log(plan: ServicePlan, start: date, rng: random.Random) -> bytes:
    """One nginx combined line per event, oldest first."""
    planted = _planted_events(rng, plan)
    events = planted + _benign_events(rng, plan.log_lines - len(planted))
    origin = datetime(start.year, start.month, start.day, tzinfo=UTC)
    lines = []
    for offset, ip, path, status in sorted(events):
        stamp = (origin + timedelta(seconds=offset)).strftime("%d/%b/%Y:%H:%M:%S +0000")
        agent = rng.choice(USER_AGENTS)
        lines.append(
            f'{ip} - - [{stamp}] "GET {path} HTTP/1.1" {status} '
            f'{rng.randint(120, 9000)} "-" "{agent}"'
        )
    return ("\n".join(lines) + "\n").encode()
