"""Everything one run produced, gathered into a single value.

The three reader-facing modules — `artifacts.py`, `console.py` and
`plots.py` — all need the same set of results, and none of them should be
able to recompute one. So a run is assembled once into the frozen bundle
below and the three of them only read it.

`verification` and `duals` are optional, and that is not defensive typing.
A return target the mandate cannot reach comes back `infeasible`, with no
weights to verify and no constraints to price. That is a result the lab
reports verbatim rather than an error, so the bundle has to be able to
hold it: the console prints the status and no book, and `solution.json`
records the status with a null weight vector.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from app.contracts import (
    DualRow,
    FrontierPoint,
    LadderRow,
    MarketScenarios,
    Scenario,
    SolveOutcome,
    VerificationReport,
)
from app.studies import EllipticalResult
from app.studies_optimism import OptimismResult

# The reported key on the left, the installed distribution on the right.
# `cvxpy` and `numpy` are pinned by this lab's own manifest. `clarabel`
# and `highspy` are not pinned anywhere: they arrive as CVXPY's
# requirements, and which build of them is installed is what decides the
# numbers a solve produces. `scipy` is pinned in the dev group for its
# type stubs but resolved through CVXPY at runtime. All five are recorded
# because reproducing a figure needs the whole path from model to answer.
#
# Read through `importlib.metadata` rather than by importing each package.
# That keeps the artifact writer free of a runtime import of CVXPY (the
# solvers stay behind `cvxpy_api.py`), and it is also the only way to get
# a version out of `highspy`, which ships no `__version__` attribute.
VERSION_PACKAGES: Mapping[str, str] = {
    "cvxpy": "cvxpy",
    "clarabel": "clarabel",
    "highs": "highspy",
    "numpy": "numpy",
    "scipy": "scipy",
}

# What is recorded for a package that is not installed at all. A string
# rather than a missing key, so the provenance block always has the same
# shape and a reader can see which component was absent.
MISSING_VERSION = "not installed"


def resolve_versions() -> Mapping[str, str]:
    """Return the installed version of every library a result depends on.

    Returns:
        One entry per key of `VERSION_PACKAGES`, holding the installed
        version string or `MISSING_VERSION`.
    """
    resolved: dict[str, str] = {}
    for key, package in VERSION_PACKAGES.items():
        try:
            resolved[key] = version(package)
        except PackageNotFoundError:
            resolved[key] = MISSING_VERSION
    return resolved


def file_digest(path: Path) -> str:
    """Return a sha256 digest over a file's bytes.

    Used on `scenario.yaml` so a result carries a fingerprint of the input
    that produced it. Two runs quoting the same scenario digest and the
    same market digest were asked the same question of the same numbers.
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class RunBundle:
    """One complete run: its inputs, its answer and everything measured.

    `verification` and `duals` are absent exactly when `headline` carries
    no solution — see the module docstring.
    """

    scenario: Scenario
    scenario_digest: str
    market: MarketScenarios
    out_of_sample: MarketScenarios
    headline: SolveOutcome
    verification: VerificationReport | None
    frontier: tuple[FrontierPoint, ...]
    ladder: tuple[LadderRow, ...]
    duals: tuple[DualRow, ...]
    elliptical: EllipticalResult
    optimism: OptimismResult
    versions: Mapping[str, str]
