"""The triage report the agent writes, validated strictly."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from app.errors import ReportError
from app.fixtures.runbook import REPORT_SCHEMA_EXAMPLE

__all__ = [
    "REPORT_SCHEMA_EXAMPLE",
    "Dependency",
    "ServiceFindings",
    "TriageReport",
    "load_report",
]

_STRICT = ConfigDict(extra="forbid", strict=True)


class Dependency(BaseModel):
    """One vulnerable package and the advisory that flags it."""

    model_config = _STRICT

    package: str
    version: str
    advisory_id: str


class ServiceFindings(BaseModel):
    """Everything the agent flagged for one service."""

    model_config = _STRICT

    service: str
    suspicious_ips: list[str]
    risky_config: list[str]
    vulnerable_dependencies: list[Dependency]


class TriageReport(BaseModel):
    """One week's report across all services."""

    model_config = _STRICT

    week: str
    services: list[ServiceFindings]


def load_report(path: Path) -> TriageReport:
    """Reads and validates a report; raises `ReportError` on any problem."""
    try:
        return TriageReport.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as err:
        raise ReportError(f"cannot read report {path}: {err}") from err
    except ValidationError as err:
        raise ReportError(f"invalid report {path}: {err}") from err
