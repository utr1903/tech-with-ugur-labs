"""The triage rules, exactly as the runbook states them, and answer keys."""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import yaml

from app.errors import FixtureError
from app.fixtures.config_rules import RISKY_FLAGS, risky_flags
from app.fixtures.versions import compare_versions

__all__ = [
    "AUTH_FAIL_THRESHOLD",
    "PROBE_PATHS",
    "RISKY_FLAGS",
    "Advisory",
    "LogEntry",
    "ServiceAnswer",
    "VulnerableDependency",
    "WeekAnswer",
    "answers_for_week",
    "load_advisories",
    "parse_lock",
    "parse_log_line",
    "risky_flags",
    "suspicious_ips",
    "vulnerable",
]

PROBE_PATHS: tuple[str, ...] = (
    "/.env",
    "/.git/config",
    "/wp-login.php",
    "/server-status",
    "/actuator/env",
)
AUTH_FAIL_THRESHOLD = 20
AUTH_FAIL_STATUSES = frozenset({401, 403})
_LOG_PATTERN = re.compile(
    r'^(\S+) \S+ \S+ \[[^\]]+\] "\S+ (\S+) [^"]*" (\d{3}) \S+ "[^"]*" "[^"]*"$'
)


@dataclass(frozen=True)
class LogEntry:
    """The three fields of an nginx combined log line the rules use."""

    ip: str
    path: str
    status: int


@dataclass(frozen=True)
class Advisory:
    """A fictional advisory: `introduced <= version < fixed` is affected."""

    id: str
    package: str
    ranges: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class VulnerableDependency:
    """One pinned package that an advisory covers."""

    package: str
    version: str
    advisory_id: str


@dataclass(frozen=True)
class ServiceAnswer:
    """The expected findings for one service."""

    service: str
    suspicious_ips: tuple[str, ...]
    risky_config: tuple[str, ...]
    vulnerable_dependencies: tuple[VulnerableDependency, ...]


@dataclass(frozen=True)
class WeekAnswer:
    """The expected findings for the whole fleet in one week."""

    week: str
    services: tuple[ServiceAnswer, ...]

    def to_report_dict(self) -> dict[str, object]:
        """Renders the answer in the triage report schema, sorted."""
        return {
            "week": self.week,
            "services": [
                {
                    "service": item.service,
                    "suspicious_ips": sorted(item.suspicious_ips),
                    "risky_config": sorted(item.risky_config),
                    "vulnerable_dependencies": [
                        {
                            "package": dep.package,
                            "version": dep.version,
                            "advisory_id": dep.advisory_id,
                        }
                        for dep in sorted(
                            item.vulnerable_dependencies,
                            key=lambda d: (d.package, d.advisory_id),
                        )
                    ],
                }
                for item in sorted(self.services, key=lambda s: s.service)
            ],
        }


def parse_log_line(line: str) -> LogEntry | None:
    """Parses an nginx combined line; the query string is dropped."""
    match = _LOG_PATTERN.match(line)
    if match is None:
        return None
    ip, target, status = match.groups()
    return LogEntry(ip=ip, path=target.split("?", 1)[0], status=int(status))


def suspicious_ips(entries: Iterable[LogEntry]) -> frozenset[str]:
    """IPs with 20+ 401/403 responses, or any exact probe-path request."""
    failures: Counter[str] = Counter()
    probers: set[str] = set()
    for entry in entries:
        if entry.status in AUTH_FAIL_STATUSES:
            failures[entry.ip] += 1
        if entry.path in PROBE_PATHS:
            probers.add(entry.ip)
    brute = {ip for ip, count in failures.items() if count >= AUTH_FAIL_THRESHOLD}
    return frozenset(brute | probers)


def parse_lock(text: str) -> tuple[tuple[str, str], ...]:
    """Reads `name==version` lines; comments and blanks are skipped."""
    pins: list[tuple[str, str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, _, version = line.partition("==")
        pins.append((name.strip().lower(), version.strip()))
    return tuple(pins)


def vulnerable(
    lock: Iterable[tuple[str, str]], advisories: Iterable[Advisory]
) -> frozenset[tuple[str, str, str]]:
    """Every (package, version, advisory id) where the pin is affected."""
    advisory_list = tuple(advisories)
    return frozenset(
        (package, version, advisory.id)
        for package, version in lock
        for advisory in advisory_list
        if advisory.package == package
        and any(
            compare_versions(version, introduced) >= 0
            and compare_versions(version, fixed) < 0
            for introduced, fixed in advisory.ranges
        )
    )


def load_advisories(path: Path) -> tuple[Advisory, ...]:
    """Reads a week's advisories.json."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        return tuple(
            Advisory(
                id=item["id"],
                package=item["package"],
                ranges=tuple((r["introduced"], r["fixed"]) for r in item["affected"]),
            )
            for item in document["advisories"]
        )
    except (OSError, ValueError, KeyError, TypeError) as err:
        raise FixtureError(f"cannot read advisories at {path}") from err


def _answer_for_service(
    service_dir: Path, advisories: tuple[Advisory, ...]
) -> ServiceAnswer:
    try:
        entries = [
            entry
            for line in (service_dir / "access.log").read_text().splitlines()
            if (entry := parse_log_line(line)) is not None
        ]
        config = yaml.safe_load((service_dir / "config.yaml").read_text())
        lock = parse_lock((service_dir / "requirements.lock").read_text())
    except (OSError, yaml.YAMLError) as err:
        raise FixtureError(f"cannot read service files in {service_dir}") from err
    if not isinstance(config, dict):
        raise FixtureError(f"config in {service_dir} is not a mapping")
    return ServiceAnswer(
        service=service_dir.name,
        suspicious_ips=tuple(sorted(suspicious_ips(entries))),
        risky_config=tuple(sorted(risky_flags(config))),
        vulnerable_dependencies=tuple(
            VulnerableDependency(package, version, advisory_id)
            for package, version, advisory_id in sorted(vulnerable(lock, advisories))
        ),
    )


def answers_for_week(week_dir: Path) -> WeekAnswer:
    """Applies the rules to the files on disk; the key is never hand-written."""
    advisories = load_advisories(week_dir / "advisories.json")
    service_dirs = sorted(p for p in (week_dir / "services").iterdir() if p.is_dir())
    return WeekAnswer(
        week=week_dir.name,
        services=tuple(_answer_for_service(path, advisories) for path in service_dirs),
    )
