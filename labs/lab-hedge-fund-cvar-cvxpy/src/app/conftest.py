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

from app.algorithms import run_algorithm_ladder
from app.bundle import RunBundle, file_digest, resolve_versions
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
from app.duals import build_dual_table
from app.frontier import sweep_frontier
from app.logging_setup import Logger, get_logger
from app.market import generate_scenarios
from app.model import build_atom_oracle_problem, build_cvar_problem
from app.scenario import load_scenario
from app.solver import solve_problem
from app.studies import run_elliptical_study
from app.studies_optimism import run_optimism_study
from app.tailrisk import array_digest
from app.verification import verify_solution

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
    lapse: the gross cap stays inactive — `sum(l + s)` reaches 1.3159 of
    1.32 at 600 scenarios and 1.3184 of 1.32 at 10,000 — and the split is
    padded by 8.0e-03 and 2.3e-03 there. (Read `l + s`, not `sum|w|`. That
    is the expression the cap is written on, and the two part company
    precisely because the split has gone slack — by 0.28 of NAV at 600
    scenarios and 0.075 at 10,000.)

    What widening the budgets does is not remove the padding but *enlarge*
    it, because an interior point parks the free padding just inside
    whatever budget it is given. Holding everything else fixed and moving
    the gross cap alone, at 600 scenarios: cap 1.32 gives an overlap of
    5.8e-03, cap 2.0 gives 2.1e-02, cap 6.0 gives 9.4e-02, with `sum(l+s)`
    coming back at 1.3134, 1.9841 and 5.9697 respectively — within a
    percent of the cap every time. So the fixture uses a wide cap to make
    the lapse unmistakable rather than marginal, and the test reads every
    premise off `l + s` before it looks at the overlap.

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


@pytest.fixture(scope="session")
def bundle_scenario(small_scenario: Scenario) -> Scenario:
    """Return the shipped mandate cut down to a size the suite can afford.

    The sweep, the ladder and the two studies are all sized in the scenario
    file for a run a reader watches once. A test needs the shapes rather
    than the precision, so the grid is four targets instead of
    twenty-five, the ladder is two rungs instead of three, and the studies
    average two seeds of 600 scenarios instead of five of 25,000. Every
    count here is a multiple of twenty so that `(1 - 0.95) * S` stays a
    whole number, which is the condition under which the linear program,
    the `sum_largest` oracle and `cvxpy.cvar` are exactly equal.
    """
    return replace(
        small_scenario,
        frontier=replace(small_scenario.frontier, points=4, max_target_monthly=0.006),
        algorithms=replace(
            small_scenario.algorithms, scenario_ladder=(400, SMALL_SAMPLE)
        ),
        studies=replace(small_scenario.studies, seeds=2, scenarios=SMALL_SAMPLE),
    )


@pytest.fixture(scope="session")
def bundle(
    bundle_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    scenario_path: Path,
    log: Logger,
) -> RunBundle:
    """Run everything once, at test size, and gather it the way a run does.

    Session-scoped because it is the most expensive fixture in the suite:
    it solves the headline twice, prices five limits with two re-solves
    each, sweeps four targets under two models, climbs two ladder rungs
    under three algorithms and runs both studies over two seeds.
    """
    target = bundle_scenario.headline_target_monthly
    built = build_cvar_problem(bundle_scenario, small_market, log=log)
    headline = solve_problem(built, algorithm="CLARABEL", target=target, log=log)
    oracle = solve_problem(
        build_atom_oracle_problem(bundle_scenario, small_market, log=log),
        algorithm="CLARABEL",
        target=target,
        log=log,
    )
    assert oracle.solution is not None
    return RunBundle(
        scenario=bundle_scenario,
        scenario_digest=file_digest(scenario_path),
        market=small_market,
        out_of_sample=small_out_of_sample,
        headline=headline,
        verification=verify_solution(
            bundle_scenario,
            small_market,
            small_out_of_sample,
            headline,
            oracle.solution.objective,
            target=target,
            log=log,
        ),
        frontier=sweep_frontier(bundle_scenario, small_market, log=log),
        ladder=run_algorithm_ladder(bundle_scenario, log=log),
        duals=build_dual_table(bundle_scenario, small_market, built, headline, log=log),
        elliptical=run_elliptical_study(bundle_scenario, log=log),
        optimism=run_optimism_study(bundle_scenario, log=log),
        versions=resolve_versions(),
    )


@pytest.fixture
def inaccurate_bundle(bundle: RunBundle) -> RunBundle:
    """Return the same run with the solver's status one notch short.

    `optimal_inaccurate` means the method stopped before reaching its own
    tolerance. The book is still there and still worth looking at, which is
    why the lab reports it rather than discarding it — and why it is
    reported under that name and never as `optimal`.
    """
    return replace(
        bundle, headline=replace(bundle.headline, status="optimal_inaccurate")
    )


@pytest.fixture
def infeasible_bundle(bundle: RunBundle) -> RunBundle:
    """Return a run whose headline target the mandate could not reach.

    No weights, so nothing to verify and no constraints to price. Both
    fields are empty rather than stale, because a report carrying the
    previous solve's numbers under an `infeasible` status would be the
    worst available answer.
    """
    return replace(
        bundle,
        headline=replace(bundle.headline, status="infeasible", solution=None, duals={}),
        verification=None,
        duals=(),
    )
