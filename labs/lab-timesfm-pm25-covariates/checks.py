"""The assertions that decide whether this run means anything.

Note what is NOT here: whether the honest covariate configurations beat the
univariate one. That is the question the lab is asking, and asserting an answer
to it would make the answer worthless. It is reported, not enforced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd

import labconfig
import snapshot
from windows import Window

HONEST_TIMESFM = (
    "timesfm-univariate",
    "timesfm-past-only",
    "timesfm-past-future",
    "timesfm-both",
)


@dataclass(frozen=True)
class CheckResult:
    """One assertion and what it saw."""

    name: str
    passed: bool
    detail: str


def _snapshot_integrity(frame: pd.DataFrame) -> CheckResult:
    try:
        snapshot.validate_snapshot(frame)
    except snapshot.SnapshotError as error:
        return CheckResult("snapshot-integrity", False, str(error))
    return CheckResult(
        "snapshot-integrity",
        True,
        f"{len(frame)} contiguous hourly rows, no nulls, one aligned grid",
    )


def _shapes_and_finiteness(
    built: Sequence[Window], results: dict[str, dict]
) -> CheckResult:
    expected_points = (len(built), labconfig.HORIZON_HOURS)
    expected_quantiles = (*expected_points, labconfig.N_QUANTILES)
    problems = []
    for name, result in results.items():
        points, quantiles = result["points"], result["quantiles"]
        if points.shape != expected_points:
            problems.append(f"{name}: points {points.shape} != {expected_points}")
        if quantiles.shape != expected_quantiles:
            problems.append(
                f"{name}: quantiles {quantiles.shape} != {expected_quantiles}"
            )
        if not np.isfinite(points).all():
            problems.append(f"{name}: non-finite point forecasts")
        if not np.isfinite(quantiles).all():
            problems.append(f"{name}: non-finite quantiles")
    if problems:
        return CheckResult("shapes-and-finiteness", False, "; ".join(problems))
    return CheckResult(
        "shapes-and-finiteness",
        True,
        f"all {len(results)} configurations produced finite "
        f"{expected_points[0]}x{expected_points[1]} forecasts",
    )


def _beats_the_baseline(results: dict[str, dict]) -> CheckResult:
    baseline_mae = results["seasonal-naive"]["scores"]["mae"]
    model_mae = results["timesfm-univariate"]["scores"]["mae"]
    passed = model_mae < baseline_mae
    return CheckResult(
        "beats-the-baseline",
        passed,
        f"timesfm-univariate MAE {model_mae:.2f} vs seasonal-naive "
        f"{baseline_mae:.2f} ug/m3",
    )


def _leakage_is_visible(results: dict[str, dict]) -> CheckResult:
    leaky_mae = results["leaky-control"]["scores"]["mae"]
    honest = {name: results[name]["scores"]["mae"] for name in HONEST_TIMESFM}
    best_honest = min(honest.values())
    passed = leaky_mae < best_honest
    return CheckResult(
        "leakage-is-visible",
        passed,
        f"leaky-control MAE {leaky_mae:.2f} vs best honest {best_honest:.2f} "
        "ug/m3 - if this fails, the covariate arguments are being ignored",
    )


def _calibration_sanity(results: dict[str, dict]) -> CheckResult:
    problems = []
    for name in HONEST_TIMESFM:
        coverage = results[name]["scores"]["coverage"]
        if not labconfig.MIN_BAND_COVERAGE <= coverage <= labconfig.MAX_BAND_COVERAGE:
            problems.append(f"{name}: {coverage:.2f}")
    if problems:
        return CheckResult(
            "calibration-sanity",
            False,
            "0.1-0.9 band coverage outside "
            f"[{labconfig.MIN_BAND_COVERAGE}, {labconfig.MAX_BAND_COVERAGE}]: "
            + ", ".join(problems),
        )
    covers = [results[name]["scores"]["coverage"] for name in HONEST_TIMESFM]
    return CheckResult(
        "calibration-sanity",
        True,
        f"0.1-0.9 band covers {min(covers):.2f}-{max(covers):.2f} of actuals",
    )


def _determinism(
    results: dict[str, dict], repeat: np.ndarray | None
) -> CheckResult:
    if repeat is None:
        return CheckResult("determinism", False, "no repeat run was supplied")
    first = results["timesfm-univariate"]["points"][: len(repeat)]
    identical = np.array_equal(first, repeat)
    return CheckResult(
        "determinism",
        identical,
        f"two runs over {len(repeat)} origins produced "
        f"{'bit-identical' if identical else 'DIFFERENT'} point forecasts",
    )


def run_all(
    frame: pd.DataFrame,
    built: Sequence[Window],
    results: dict[str, dict],
    determinism_repeat: np.ndarray | None,
) -> list[CheckResult]:
    """Runs every hard check, in the order the README lists them."""
    return [
        _snapshot_integrity(frame),
        _shapes_and_finiteness(built, results),
        _beats_the_baseline(results),
        _leakage_is_visible(results),
        _calibration_sanity(results),
        _determinism(results, determinism_repeat),
    ]


def format_results(outcomes: Sequence[CheckResult]) -> str:
    """Renders the checks as a readable block."""
    lines = ["", "Checks", "------"]
    for outcome in outcomes:
        mark = "PASS" if outcome.passed else "FAIL"
        lines.append(f"[{mark}] {outcome.name}: {outcome.detail}")
    return "\n".join(lines)
