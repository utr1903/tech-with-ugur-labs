"""The shipped scenario, end to end, at its real settings.

Every other test in this suite runs a cut-down mandate — 600 scenarios, a
four-point frontier, two study seeds — because it runs on every change.
This one runs what the reader runs: `scenario.yaml` exactly as committed,
into a temporary directory, once.

**It is the only place the shipped study thresholds are asserted.**
`studies.elliptical_weight_tolerance` and `studies.divergence_ratio_min`
are calibrated at five seeds and 25,000 scenarios, and `studies_test.py`
deliberately asserts against its own thresholds measured at its own
smaller sample instead — a ceiling calibrated at 25,000 scenarios and
asserted at 3,000 would be a test of the sample size rather than of the
effect. That left the two shipped numbers with no guard at all: a
recalibration could move either of them anywhere and `uv run pytest`
would stay green. The run below has already paid for both studies at the
shipped settings, so asserting them here costs nothing but the two lines.

Marked `e2e`, so it can be run on its own with `-m e2e`, or skipped with
`-m "not e2e"` while iterating on something else.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest

from app.commands.run import run
from app.contracts import Scenario
from app.logging_setup import Logger
from app.solver import SOLUTION_STATUSES

LAB_ROOT = Path(__file__).resolve().parents[2]

ARTIFACTS = (
    "weights.csv",
    "sectors.csv",
    "frontier.csv",
    "algorithms.csv",
    "duals.csv",
    "solution.json",
    "frontier.png",
    "loss_distribution.png",
    "exposures.png",
)

# The lab's stated budget for one default run. The README quotes the
# measurement taken inside the container; this is the ceiling that
# measurement has to stay under, and it is deliberately generous — a
# laptop running a test suite is not a benchmark rig.
RUN_SECONDS_TARGET = 180.0

# The two study gates as shipped, pinned here as literals so that
# loosening either field in `scenario.yaml` fails this file rather than
# passing quietly. Measured on the shipped scenario at five seeds and
# 25,000 scenarios: a Gaussian control distance of 0.0386 against the
# 0.10 ceiling, and a divergence ratio of 3.295 against the 2.0 floor.
SHIPPED_WEIGHT_TOLERANCE = 0.10
SHIPPED_DIVERGENCE_FLOOR = 2.0


@pytest.fixture(scope="module")
def shipped_run(
    tmp_path_factory: pytest.TempPathFactory, log: Logger
) -> tuple[Path, float]:
    """Run `scenario.yaml` once at its committed settings, and time it."""
    output = tmp_path_factory.mktemp("e2e")
    started = time.perf_counter()
    run(LAB_ROOT / "scenario.yaml", output, mode=None, seed=None, log=log)
    return output, time.perf_counter() - started


@pytest.fixture(scope="module")
def payload(shipped_run: tuple[Path, float]) -> dict[str, Any]:
    """Return the shipped run's `solution.json`."""
    output, _ = shipped_run
    document: dict[str, Any] = json.loads(
        (output / "solution.json").read_text(encoding="utf-8")
    )
    return document


@pytest.mark.e2e
def test_the_shipped_scenario_writes_every_artifact(
    shipped_run: tuple[Path, float],
) -> None:
    """All six result files and all three plots land, and nothing else does."""
    output, _ = shipped_run
    assert {path.name for path in output.iterdir()} == set(ARTIFACTS)
    assert all((output / name).stat().st_size > 0 for name in ARTIFACTS)


@pytest.mark.e2e
def test_the_shipped_scenario_solves_and_passes_every_check(
    payload: dict[str, Any],
) -> None:
    """The headline is optimal, verbatim, and every recomputed figure agrees."""
    assert payload["status"] == "optimal"
    assert payload["headline"]["solver_name"] == "CLARABEL"
    checks = payload["verification"]["checks"]
    assert checks
    assert [entry["name"] for entry in checks if not entry["passed"]] == []


@pytest.mark.e2e
def test_the_shipped_scenario_scores_on_a_disjoint_out_of_sample_matrix(
    payload: dict[str, Any],
) -> None:
    """The ruler is a different draw, not the matrix the book was chosen on."""
    assert payload["market"]["seed"] != payload["out_of_sample"]["seed"]
    assert payload["market"]["digest"] != payload["out_of_sample"]["digest"]


@pytest.mark.e2e
def test_the_shipped_frontier_reports_unreachable_targets_verbatim(
    payload: dict[str, Any], scenario: Scenario
) -> None:
    """Every swept target keeps its status, and carries a book only if it has one."""
    points = payload["frontier"]
    assert len(points) == scenario.frontier.points
    for point in points:
        outcome = point["cvar"]
        assert (outcome["solution"] is not None) == (
            outcome["status"] in SOLUTION_STATUSES
        )


@pytest.mark.e2e
def test_the_shipped_study_thresholds_are_met_at_their_own_settings(
    payload: dict[str, Any], scenario: Scenario
) -> None:
    """The two calibrated gates in `scenario.yaml` hold where they were set.

    Two assertions each, for the reason `algorithms_test.py` gives about
    its own ceiling: the first pair says the shipped gate is no looser
    than what was measured, so widening a field without re-measuring
    fails here; the second pair says the run actually clears the gate.
    Asserting only the second would restate the field against itself.
    """
    study = payload["elliptical_study"]
    assert scenario.studies.elliptical_weight_tolerance <= SHIPPED_WEIGHT_TOLERANCE
    assert scenario.studies.divergence_ratio_min >= SHIPPED_DIVERGENCE_FLOOR
    assert study["seeds"] == scenario.studies.seeds
    assert (
        study["gaussian_weight_distance"]
        <= scenario.studies.elliptical_weight_tolerance
    )
    assert study["divergence_ratio"] >= scenario.studies.divergence_ratio_min
    assert study["fat_tailed_out_of_sample_cvar_gap"] > 0.0


@pytest.mark.e2e
def test_the_shipped_run_fits_the_stated_budget(
    shipped_run: tuple[Path, float],
) -> None:
    """One default run finishes inside the time the README promises."""
    _, seconds = shipped_run
    assert seconds < RUN_SECONDS_TARGET
