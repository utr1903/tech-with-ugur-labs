"""Fixtures shared by the colocated tests.

The shipped scenario is loaded once per session and handed out read-only:
every dataclass in `contracts` is frozen and every array inside one is
non-writeable, so sharing them between tests cannot leak state.

`load_mutated` is how the rejection tables work. Rather than restating the
scenario file, they parse the shipped one, break exactly one thing, dump it
to a temporary file and load that — so editing `scenario.yaml` can never
leave a rejection table validating a scenario the lab no longer ships.
"""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import yaml

from app.contracts import (
    DeskLimits,
    FloatArray,
    GeneratorSettings,
    MarketScenarios,
    Scenario,
    Universe,
    frozen_float_array,
    frozen_int_array,
)
from app.logging_setup import Logger, get_logger
from app.market import generate_scenarios
from app.scenario import load_scenario
from app.tailrisk import array_digest

LAB_ROOT = Path(__file__).resolve().parents[2]

# The distribution-shape and closed-form tests need a sample large enough to
# tell two distributions apart rather than one cheap enough to be free. The
# two draws below are session-scoped so that cost is paid once for the whole
# suite; the matrices they hold are read-only, like everything else here.
LARGE_SAMPLE = 200_000

# The sample every solving test runs on. It is small enough that a solve
# costs tens of milliseconds and the whole suite stays interactive, and it
# is a multiple of twenty so that `(1 - 0.95) * S` is a whole number — the
# condition under which the linear program, the `sum_largest` oracle and
# `cvxpy.cvar` are all exactly the same number rather than nearly so.
SMALL_SAMPLE = 600

Document = dict[str, Any]
Mutation = Callable[[Document], None]
MutatedLoader = Callable[[Mutation], Scenario]


@pytest.fixture(scope="session")
def log() -> Logger:
    """Return a bound logger for tests, with no global configuration."""
    return get_logger(app_name="test")


@pytest.fixture(scope="session")
def scenario_path() -> Path:
    """Return the path of the scenario file the lab ships."""
    return LAB_ROOT / "scenario.yaml"


@pytest.fixture(scope="session")
def scenario(scenario_path: Path, log: Logger) -> Scenario:
    """Load the shipped 30-name scenario."""
    return load_scenario(scenario_path, log=log)


@pytest.fixture(scope="session")
def universe(scenario: Scenario) -> Universe:
    """Return the shipped universe."""
    return scenario.universe


@pytest.fixture(scope="session")
def generator_settings(scenario: Scenario) -> GeneratorSettings:
    """Return the shipped generator settings."""
    return scenario.market


@pytest.fixture(scope="session")
def document(scenario_path: Path) -> Document:
    """Parse the shipped scenario into a plain dictionary for mutation."""
    parsed = yaml.safe_load(scenario_path.read_text(encoding="utf-8"))
    assert isinstance(parsed, dict)
    return parsed


@pytest.fixture
def load_mutated(tmp_path: Path, document: Document, log: Logger) -> MutatedLoader:
    """Return a loader that applies one mutation to the shipped scenario."""

    def load(mutate: Mutation) -> Scenario:
        candidate = deepcopy(document)
        mutate(candidate)
        path = tmp_path / "scenario.yaml"
        path.write_text(yaml.safe_dump(candidate, sort_keys=False), encoding="utf-8")
        return load_scenario(path, log=log)

    return load


@pytest.fixture(scope="session")
def large_fat_tailed(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> MarketScenarios:
    """Draw one large fat-tailed sample."""
    return generate_scenarios(
        universe,
        generator_settings,
        seed=3,
        count=LARGE_SAMPLE,
        mode="fat_tailed",
        log=log,
    )


@pytest.fixture(scope="session")
def large_gaussian(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> MarketScenarios:
    """Draw the matching large control sample from the same seed."""
    return generate_scenarios(
        universe,
        generator_settings,
        seed=3,
        count=LARGE_SAMPLE,
        mode="gaussian",
        log=log,
    )


@pytest.fixture
def tiny_returns() -> FloatArray:
    """Return a hand-checkable two-asset, four-scenario return matrix."""
    return np.array(
        [[0.10, -0.20], [-0.05, 0.04], [0.02, 0.02], [-0.08, -0.06]],
        dtype=np.float64,
    )


@pytest.fixture(scope="session")
def small_scenario(scenario: Scenario) -> Scenario:
    """Return the shipped scenario cut down to a fast scenario count."""
    return replace(scenario, market=replace(scenario.market, scenarios=SMALL_SAMPLE))


@pytest.fixture(scope="session")
def small_market(small_scenario: Scenario, log: Logger) -> MarketScenarios:
    """Draw the small in-sample matrix every solving test optimizes on."""
    return generate_scenarios(
        small_scenario.universe,
        small_scenario.market,
        seed=small_scenario.market.seed,
        count=small_scenario.market.scenarios,
        mode=small_scenario.market.mode,
        log=log,
    )


@pytest.fixture(scope="session")
def small_out_of_sample(small_scenario: Scenario, log: Logger) -> MarketScenarios:
    """Draw the disjoint sample a solved book is scored on afterwards.

    Same generator, same distribution, a different seed — the matrix the
    optimizer never sees. Reporting a book's tail on the scenarios it was
    chosen to beat measures the fit, not the risk, which is why every
    verification report carries both numbers side by side.
    """
    return generate_scenarios(
        small_scenario.universe,
        small_scenario.market,
        seed=small_scenario.market.out_of_sample_seed,
        count=small_scenario.market.scenarios,
        mode=small_scenario.market.mode,
        log=log,
    )


@pytest.fixture(scope="session")
def degenerate_scenario(small_scenario: Scenario) -> Scenario:
    """Return the mandate under which the two relaxations stop being exact.

    `model_desk.py` writes `w = l - s` and `t >= |w - w0|` and then argues
    that at an optimum the legs collapse onto `|w|` and the turnover bound
    onto the real trade. Those are two arguments, not one, and they rest on
    different premises — which is why this fixture has to remove four
    things rather than three.

    The split is disciplined by a binding gross, per-name or per-sector
    cap — all three are written on `l + s` — or by a binding return target
    together with a positive *borrow fee*, which is charged on `s`. The
    turnover bound is disciplined by a binding turnover budget, or by a
    binding return target together with a positive *half-spread*, which is
    charged on `t`.

    Both costs need that same "binding return target" clause, because both
    live in the return constraint and nowhere else: while it has slack
    they charge for nothing. And the two do not swap roles — padding
    `(l, s)` leaves `w` unchanged, so it leaves `t` unchanged, so the
    half-spread never prices the split. `model_desk_test.py` switches each
    term off on its own and pins all of that.

    This fixture removes all four at once. Every borrow fee and every
    half-spread is set to zero; the gross, per-name, per-sector and
    turnover budgets are widened far past anything the solved book uses.

    Note what the widened budgets are and are not for. Zeroing the costs
    on the shipped mandate is in fact already enough to make the split
    lapse — the gross cap comes back slack at 1.0325 of 1.32 at 600
    scenarios and 1.2438 of 1.32 at 10,000, and the split is padded by
    8.0e-03 and 2.3e-03 there. The budgets are widened so that the fixture
    does not depend on that happening to be true: a reader who edits the
    universe could easily produce a book that runs into the gross cap, and
    then the fixture would be testing premise one rather than removing it.
    Here the optimum cannot reach any budget, so the premises are absent by
    construction rather than by luck, and the test asserts each one is
    slack before it looks at the overlap.

    What genuinely does not work is the two-name `tiny_scenario` below: its
    net exposure is pinned to 1.0 under a gross cap of 1.0, which makes the
    gross constraint bind exactly however generous the other limits look.

    The headline target is kept at the shipped value on purpose, so the
    fixture demonstrates the lapse on a real long-short book of about 1.08
    gross rather than on the trivial all-zero portfolio a slack target
    would produce.
    """
    zero = frozen_float_array(np.zeros(len(small_scenario.universe.names)))
    return replace(
        small_scenario,
        universe=replace(
            small_scenario.universe, borrow_fee_annual=zero, half_spread=zero
        ),
        limits=replace(
            small_scenario.limits,
            gross_leverage_max=6.0,
            name_gross_cap=1.0,
            sector_gross_cap=2.0,
            turnover_max=8.0,
        ),
    )


@pytest.fixture(scope="session")
def tiny_scenario(scenario: Scenario) -> Scenario:
    """Return a two-name mandate whose feasible set is enumerable by hand.

    Net exposure is pinned to 1.0 and gross leverage capped at 1.0, which
    between them force `w >= 0` and `sum(w) == 1`: the portfolio is a point
    on the line from one name to the other. Every other limit is set wide
    enough to be slack, and both names are free to borrow and free to
    trade, so nothing but the tail of the loss distribution decides the
    answer. The scenario is built here rather than loaded from YAML because
    the loader rightly insists on the lab's 30-name universe.
    """
    universe = Universe(
        names=("AAA", "BBB"),
        sectors=("one", "two"),
        sector_of=frozen_int_array([0, 1]),
        sector_matrix=frozen_float_array([[1.0, 0.0], [0.0, 1.0]]),
        market_beta=frozen_float_array([1.0, 1.0]),
        expected_return=frozen_float_array([0.012, 0.008]),
        borrow_fee_annual=frozen_float_array([0.0, 0.0]),
        half_spread=frozen_float_array([0.0, 0.0]),
        start_book=frozen_float_array([0.5, 0.5]),
    )
    limits = DeskLimits(
        gross_leverage_max=1.0,
        net_exposure_min=1.0,
        net_exposure_max=1.0,
        beta_min=0.0,
        beta_max=2.0,
        name_gross_cap=1.0,
        sector_net_cap=1.0,
        sector_gross_cap=1.0,
        turnover_max=2.0,
    )
    # Five scenarios and a 60% confidence level put exactly two of them in
    # the tail, so the objective is the average of the worst two losses and
    # a reader can work the answer out on paper.
    return replace(
        scenario,
        universe=universe,
        limits=limits,
        cvar_beta=0.6,
        headline_target_monthly=0.0,
    )


@pytest.fixture(scope="session")
def tiny_market() -> MarketScenarios:
    """Return five hand-written scenarios: one crash in each name.

    Both names have a positive mean, so a zero return target never binds,
    and each carries its own worst month, so the tail-minimizing book is a
    genuine blend rather than one name or the other.
    """
    returns = frozen_float_array(
        [
            [0.05, 0.04],
            [0.03, 0.02],
            [0.02, 0.03],
            [-0.10, 0.06],
            [0.06, -0.11],
        ]
    )
    return MarketScenarios(
        returns=returns, mode="hand_written", seed=0, digest=array_digest(returns)
    )
