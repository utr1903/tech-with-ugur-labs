"""What gets planted in one week of the fleet."""

from __future__ import annotations

from dataclasses import dataclass

from app.fixtures.catalog import AdvisorySpec
from app.fixtures.rules import ServiceAnswer, VulnerableDependency, WeekAnswer


@dataclass(frozen=True)
class ServicePlan:
    """Everything planted in one service for one week."""

    name: str
    brute_ips: tuple[str, ...]
    probe_ips: tuple[str, ...]
    decoy_ip: str
    flags: tuple[str, ...]
    packages: tuple[tuple[str, str], ...]
    vulnerable: tuple[tuple[str, str, str], ...]
    log_lines: int

    @property
    def suspicious_ips(self) -> tuple[str, ...]:
        """Planted suspicious IPs, sorted."""
        return tuple(sorted(self.brute_ips + self.probe_ips))

    def answer(self) -> ServiceAnswer:
        """The planted truth for this service."""
        return ServiceAnswer(
            service=self.name,
            suspicious_ips=self.suspicious_ips,
            risky_config=tuple(sorted(self.flags)),
            vulnerable_dependencies=tuple(
                VulnerableDependency(package, version, advisory_id)
                for package, version, advisory_id in sorted(self.vulnerable)
            ),
        )


@dataclass(frozen=True)
class WeekPlan:
    """The fleet for one week, with the advisories in force."""

    week: str
    services: tuple[ServicePlan, ...]
    advisories: tuple[AdvisorySpec, ...]

    def answer(self) -> WeekAnswer:
        """The planted truth, independent of the rules reading the files."""
        return WeekAnswer(
            week=self.week,
            services=tuple(service.answer() for service in self.services),
        )
