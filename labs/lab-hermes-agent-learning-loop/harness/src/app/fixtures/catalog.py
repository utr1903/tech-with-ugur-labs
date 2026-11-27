"""The fictional package and advisory catalogue the lockfiles draw from."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PackageSpec:
    """A package, how its lockfile line is spelled, and its pinnable versions."""

    display: str
    safe: tuple[str, ...]
    affected: tuple[str, ...] = ()


@dataclass(frozen=True)
class AdvisorySpec:
    """An invented advisory; ids are TWU-2026-NNNN, never real CVE ids."""

    id: str
    package: str
    summary: str
    introduced: str
    fixed: str


PACKAGES: dict[str, PackageSpec] = {
    "pyyaml": PackageSpec("PyYAML", ("6.0.1", "4.2"), ("5.3", "5.1.2")),
    "jinja2": PackageSpec("Jinja2", ("3.1.2", "2.7.3"), ("2.11.0", "2.10.1")),
    "urllib3": PackageSpec(
        "urllib3", ("2.0.7", "1.26.5", "1.8.4"), ("1.10.4", "1.25.8")
    ),
    "requests": PackageSpec(
        "requests", ("2.31.0", "2.32.3", "1.2.3"), ("2.25.1", "2.19.0")
    ),
    "pillow": PackageSpec("Pillow", ("10.0.0", "7.2.0"), ("8.4.0", "8.1.2")),
    "cryptography": PackageSpec(
        "cryptography", ("42.0.0", "2.9.2"), ("38.0.4", "3.4.8")
    ),
    "paramiko": PackageSpec("paramiko", ("3.4.0", "1.18.5"), ("2.12.0", "2.7.2")),
    "flask": PackageSpec("Flask", ("3.0.0", "2.3.3")),
    "django": PackageSpec("Django", ("4.2.7", "5.0.1")),
    "lxml": PackageSpec("lxml", ("4.9.3", "5.1.0")),
    "sqlalchemy": PackageSpec("SQLAlchemy", ("2.0.23", "1.4.50")),
    "celery": PackageSpec("celery", ("5.3.6", "5.2.7")),
    "gunicorn": PackageSpec("gunicorn", ("21.2.0", "20.1.0")),
}

# The last advisory appears only in the second week.
ADVISORIES: tuple[AdvisorySpec, ...] = (
    AdvisorySpec(
        "TWU-2026-0001", "pyyaml", "Unsafe loader in old releases", "5.0", "5.4"
    ),
    AdvisorySpec("TWU-2026-0002", "jinja2", "Template sandbox escape", "2.8", "3.0.0"),
    AdvisorySpec(
        "TWU-2026-0003", "urllib3", "Header leak across redirects", "1.9", "1.26.5"
    ),
    AdvisorySpec(
        "TWU-2026-0004", "requests", "Credentials kept on redirect", "2.0", "2.31.0"
    ),
    AdvisorySpec(
        "TWU-2026-0005", "pillow", "Heap overflow in image decoder", "8.0", "9.0.1"
    ),
    AdvisorySpec(
        "TWU-2026-0006", "cryptography", "Weak padding check", "3.0", "41.0.2"
    ),
    AdvisorySpec("TWU-2026-0007", "paramiko", "Handshake downgrade", "2.0", "3.4.0"),
)

ADVISORY_COUNT_BY_WEEK: dict[str, int] = {"week-1": 6, "week-2": 7}
