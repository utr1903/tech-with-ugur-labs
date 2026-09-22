"""Tests for the two comparison studies and the seed loop underneath them.

**Why these fixtures are not the shipped settings.** The shipped studies
run five seeds over 25,000 scenarios and take about sixteen seconds. That
is the measurement; this is the suite, which runs on every change to the
lab. Both fixtures below therefore shrink the sample and carry thresholds
measured *at their own size*, never the shipped ones — a threshold
calibrated at 25,000 scenarios and asserted at 3,000 would be a test of
the sample size rather than of the effect.

**And why the elliptical fixture moves the generator.** It raises
`jump_probability` from the shipped 0.002 to 0.02. That is the only field
it changes, and the reason is measured rather than convenient. The
divergence between the two models is carried by the rare one-sided jumps
and essentially only by them, and at a 0.2% monthly rate a 3,000-scenario
sample has a 150-row tail holding a handful of jump scenarios. Three seeds
at 3,000 scenarios on the shipped generator measure a divergence ratio of
**1.314** and a fat-tailed out-of-sample CVaR gap of **-1.57e-04** — the
wrong sign outright. Half of 1.314 is 0.66, and a divergence-ratio floor
below 1.0 asserts nothing at all, since a ratio of 1.0 is "the two books
are as far apart in the control as they are in the real market". Turning
that one channel up to 0.02 at the same three seeds and the same 3,000
scenarios measures a ratio of **2.750** and a gap of **+1.69e-03**, so the
floor and the tolerance below are halves and doubles of numbers that mean
something.

One field is not one effect, though, and the ratio's improvement comes
from both ends. The `gaussian` mode is moment-matched, so it inherits the
bigger jumps' variance through `market_moments.jump_moments` and the
control arm moves too. At those same three seeds and 3,000 scenarios the
fat-tailed distance goes 0.1517 to 0.2420, a factor of 1.59, while the
control goes 0.1154 to 0.0880, a factor of 0.76 — so roughly two fifths
of the ratio's gain is the denominator shrinking rather than the numerator
growing. Why the control shrinks is not isolated here and nothing below
depends on it; what the fixture needs is that both arms are declared and
both numbers are on the page.

None of this is a claim about the shipped market. The shipped generator's
own figures, at five seeds and 25,000 scenarios, are in `scenario.yaml`
beside the two thresholds they calibrate, and no test in this suite
asserts against those two thresholds.

**The stand-ins below capture the real functions at import.** Both patch a
name inside `studies_seeds`, so calling that name again from inside the
stand-in would recurse forever. They call `app.solver` and `app.market`
directly instead, which `monkeypatch.setattr` never touches.
"""

from __future__ import annotations

import re
from dataclasses import replace
from statistics import fmean

import pytest

from app import studies, studies_optimism, studies_seeds
from app.contracts import (
    GeneratorSettings,
    MarketScenarios,
    Scenario,
    SolveOutcome,
    Universe,
)
from app.errors import SolveError
from app.logging_setup import Logger
from app.market import FAT_TAILED_MODE, GAUSSIAN_MODE, generate_scenarios
from app.model import BuiltProblem, build_cvar_problem
from app.solver import solve_problem
from app.studies import EllipticalResult, run_elliptical_study
from app.studies_optimism import OptimismResult, run_optimism_study
from app.studies_seeds import (
    OUT_OF_SAMPLE_SEED_OFFSET,
    STUDY_ALGORITHM,
    draw,
    empirical_cvar,
    out_of_sample_seed,
    require_survivors,
    study_seeds,
)

# Three seeds and 3,000 scenarios for the elliptical fixture, and the two
# thresholds measured there: the Gaussian control distance came back at
# 0.0880 and the tolerance is roughly twice it, the divergence ratio at
# 2.750 and the floor roughly half. Per seed the control measured 0.0645,
# 0.1183 and 0.0811, so the ceiling clears the worst of the three by 1.5x.
STUDY_SEEDS = 3
STUDY_SCENARIOS = 3_000
STUDY_JUMP_PROBABILITY = 0.02
STUDY_WEIGHT_TOLERANCE = 0.18
STUDY_DIVERGENCE_FLOOR = 1.4

# The optimism fixture. The ladder is two cheap rungs and the out-of-sample
# matrix is 6,000 scenarios — three times the top rung, and that ratio is
# load-bearing rather than decorative. Measured on the shipped generator
# with three seeds, the shipped 0.008 headline target and a ladder of
# (500, 1500, 4000), moving *only* the out-of-sample size: at 3,000 the
# 4,000-scenario rung's gap comes back at -9.6e-05, the wrong sign, while
# the same rung measures +3.8e-04 at 6,000, +3.3e-04 at 12,000 and
# +5.1e-04 at 25,000. An out-of-sample matrix no larger than the rung it
# scores carries enough sampling error of its own to swamp the optimism it
# is there to measure.
OPTIMISM_LADDER = (500, 2_000)
OPTIMISM_OUT_OF_SAMPLE = 6_000

# A sample far too small to say anything about either effect, used by the
# tests that are about the seed bookkeeping rather than about the market.
BOOKKEEPING_SCENARIOS = 600

# A scenario count whose tail share is deliberately not a whole number:
# (1 - 0.95) * 610 is 30.5, so the tail is 31 scenarios and the linear
# program's optimum parts company with the average of those 31 losses.
# The separation floor is an order of magnitude below the 1.14e-04
# measured there and twelve orders above the 6.6e-14 the two agree to at
# 600 scenarios, where the share is a whole number.
FRACTIONAL_TAIL_RUNG = 610
FRACTIONAL_TAIL_SEPARATION = 1.0e-05


@pytest.fixture(scope="session")
def study_scenario(scenario: Scenario) -> Scenario:
    """Return the elliptical fixture: three seeds, 3,000 scenarios, big jumps."""
    return replace(
        scenario,
        market=replace(scenario.market, jump_probability=STUDY_JUMP_PROBABILITY),
        studies=replace(
            scenario.studies,
            seeds=STUDY_SEEDS,
            scenarios=STUDY_SCENARIOS,
            elliptical_weight_tolerance=STUDY_WEIGHT_TOLERANCE,
            divergence_ratio_min=STUDY_DIVERGENCE_FLOOR,
        ),
    )


@pytest.fixture(scope="session")
def optimism_scenario(scenario: Scenario) -> Scenario:
    """Return the optimism fixture: three seeds, a two-rung ladder, 6,000 scored.

    The shipped generator, unchanged. Optimism is a property of fitting
    thirty weights to the worst few percent of a finite sample, and it does
    not need the jump channel turned up to show itself.
    """
    return replace(
        scenario,
        algorithms=replace(scenario.algorithms, scenario_ladder=OPTIMISM_LADDER),
        studies=replace(
            scenario.studies, seeds=STUDY_SEEDS, scenarios=OPTIMISM_OUT_OF_SAMPLE
        ),
    )


@pytest.fixture(scope="session")
def bookkeeping_scenario(study_scenario: Scenario) -> Scenario:
    """Return a scenario small enough to run a whole study several times over.

    Nothing measured on it is a claim about the market: at 600 scenarios
    neither effect is visible. It exists so the tests about skipping and
    averaging can run a study three times for a few tenths of a second.
    """
    return replace(
        study_scenario,
        studies=replace(study_scenario.studies, scenarios=BOOKKEEPING_SCENARIOS),
    )


@pytest.fixture(scope="session")
def elliptical_result(study_scenario: Scenario, log: Logger) -> EllipticalResult:
    """Run the elliptical study once and share it with every test that reads it."""
    return run_elliptical_study(study_scenario, log=log)


@pytest.fixture(scope="session")
def optimism_result(optimism_scenario: Scenario, log: Logger) -> OptimismResult:
    """Run the optimism study once and share it."""
    return run_optimism_study(optimism_scenario, log=log)


class _RefusingSolver:
    """A `solve_problem` stand-in that refuses the numbered calls.

    Calls are counted across a whole study in the order the seed loop makes
    them, so a test can name exactly which seed's solve fails. A refused
    call never reaches the solver, which is what keeps these tests cheap;
    every other call goes through to the real one.
    """

    def __init__(self, fail_calls: frozenset[int]) -> None:
        self.fail_calls = fail_calls
        self.made = 0

    def __call__(
        self, built: BuiltProblem, *, algorithm: str, target: float, log: Logger
    ) -> SolveOutcome:
        self.made += 1
        if self.made in self.fail_calls:
            return SolveOutcome(
                status="infeasible",
                solution=None,
                solver_name=algorithm,
                solve_seconds=0.0,
                iterations=None,
                duals={},
            )
        return solve_problem(built, algorithm=algorithm, target=target, log=log)


class _RecordingSolver:
    """A `solve_problem` wrapper that records the target and kind of each call."""

    def __init__(self) -> None:
        self.targets: list[float] = []
        self.kinds: list[str] = []

    def __call__(
        self, built: BuiltProblem, *, algorithm: str, target: float, log: Logger
    ) -> SolveOutcome:
        self.targets.append(target)
        self.kinds.append(built.kind)
        return solve_problem(built, algorithm=algorithm, target=target, log=log)


class _RecordingGenerator:
    """A `generate_scenarios` wrapper that records every draw a study makes."""

    def __init__(self) -> None:
        self.draws: list[tuple[str, int, int]] = []

    def __call__(
        self,
        universe: Universe,
        settings: GeneratorSettings,
        *,
        seed: int,
        count: int,
        mode: str,
        log: Logger,
    ) -> MarketScenarios:
        self.draws.append((mode, seed, count))
        return generate_scenarios(
            universe, settings, seed=seed, count=count, mode=mode, log=log
        )


def test_gaussian_mode_makes_the_two_models_agree(
    study_scenario: Scenario, elliptical_result: EllipticalResult
) -> None:
    """The control: with an elliptical market the two books nearly coincide.

    For an elliptical distribution CVaR at a fixed level is
    `-mu'w + c_beta * sigma(w)`. With the return target binding `mu'w` is
    pinned, so minimizing CVaR is minimizing `sigma(w)`, which is the
    problem the variance model solves. What distance is left is sampling
    error in a finite draw rather than disagreement between the models.
    """
    assert (
        elliptical_result.gaussian_weight_distance
        <= study_scenario.studies.elliptical_weight_tolerance
    )


def test_fat_tails_make_the_two_models_diverge(
    study_scenario: Scenario, elliptical_result: EllipticalResult
) -> None:
    """The claim: once the tail is heavy and one-sided the books part company."""
    assert (
        elliptical_result.divergence_ratio
        >= study_scenario.studies.divergence_ratio_min
    )


def test_the_cvar_portfolio_has_the_shallower_tail_out_of_sample(
    elliptical_result: EllipticalResult,
) -> None:
    """And the divergence is worth something on scenarios nobody optimized on.

    In sample the CVaR book must win, because minimizing that number is
    exactly what it did. The claim that matters is that it still wins on a
    disjoint draw, and that is what this measures.
    """
    assert elliptical_result.fat_tailed_out_of_sample_cvar_gap > 0.0


def test_in_sample_cvar_is_optimistic_at_every_scenario_count(
    optimism_result: OptimismResult,
) -> None:
    """The reported tail is better than the delivered one at every rung.

    The direction is asserted; the size is only reported. How large the gap
    is depends on the generator, the mandate and the target, so pinning a
    magnitude would pin this scenario file rather than the phenomenon.
    """
    assert optimism_result.rows
    assert all(row.gap > 0.0 for row in optimism_result.rows)
    assert all(
        row.in_sample_cvar < row.out_of_sample_cvar for row in optimism_result.rows
    )


def test_the_optimism_gap_shrinks_as_scenarios_grow(
    optimism_result: OptimismResult,
) -> None:
    """More scenarios leave the optimizer less of the sample's luck to exploit."""
    rows = optimism_result.rows
    assert len(rows) >= 2
    assert rows[-1].gap < rows[0].gap


def test_both_models_are_compared_at_the_same_return_target(
    bookkeeping_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every arm of the elliptical comparison solves at the matched target.

    This is what makes the study an isolation of distribution shape. Solve
    the CVaR book at one required return and the variance book at another
    and the distance between them becomes a distance between two mandates,
    about which the theorem says nothing.
    """
    recorder = _RecordingSolver()
    monkeypatch.setattr(studies_seeds, "solve_problem", recorder)

    run_elliptical_study(bookkeeping_scenario, log=log)

    target = bookkeeping_scenario.studies.matched_target_monthly
    assert recorder.targets == [target] * (bookkeeping_scenario.studies.seeds * 4)
    # Both models, every time: two kinds, each solved once per seed per mode.
    assert recorder.kinds.count("cvar") == recorder.kinds.count("variance")


def test_the_two_modes_are_drawn_from_the_same_seeds(
    bookkeeping_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The control and the real market differ in mode and in nothing else.

    Same seeds, same scenario count, same out-of-sample offset. A study
    that drew its control from different seeds would be comparing two
    draws as much as two distributions.
    """
    recorder = _RecordingGenerator()
    monkeypatch.setattr(studies_seeds, "generate_scenarios", recorder)

    run_elliptical_study(bookkeeping_scenario, log=log)

    gaussian = [record[1:] for record in recorder.draws if record[0] == GAUSSIAN_MODE]
    fat_tailed = [
        record[1:] for record in recorder.draws if record[0] == FAT_TAILED_MODE
    ]
    assert gaussian == fat_tailed
    assert gaussian
    assert all(count == BOOKKEEPING_SCENARIOS for _, count in gaussian)


def test_the_out_of_sample_matrix_is_a_different_seed_entirely(
    bookkeeping_scenario: Scenario, log: Logger
) -> None:
    """Out of sample means a fresh draw, not a slice of the same one."""
    seed = bookkeeping_scenario.market.seed
    assert out_of_sample_seed(seed) - seed == OUT_OF_SAMPLE_SEED_OFFSET
    # The offset has to clear any seed count the lab would ever run, or one
    # seed's out-of-sample matrix would be another seed's training set.
    assert bookkeeping_scenario.studies.seeds < OUT_OF_SAMPLE_SEED_OFFSET

    in_sample = draw(
        bookkeeping_scenario,
        seed=seed,
        count=BOOKKEEPING_SCENARIOS,
        mode=FAT_TAILED_MODE,
        log=log,
    )
    scored = draw(
        bookkeeping_scenario,
        seed=out_of_sample_seed(seed),
        count=BOOKKEEPING_SCENARIOS,
        mode=FAT_TAILED_MODE,
        log=log,
    )
    assert in_sample.digest != scored.digest


def test_the_out_of_sample_size_is_fixed_across_the_ladder(
    optimism_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every rung is scored on a matrix of the same size, not of its own size.

    Scoring a 500-scenario book on 500 fresh scenarios and a 2,000-scenario
    book on 2,000 fresh ones would leave two different amounts of sampling
    error down the column, so a shrinking gap could be the estimator
    settling rather than the fit improving.
    """
    recorder = _RecordingGenerator()
    monkeypatch.setattr(studies_seeds, "generate_scenarios", recorder)

    run_optimism_study(optimism_scenario, log=log)

    boundary = optimism_scenario.market.seed + OUT_OF_SAMPLE_SEED_OFFSET
    scored = [count for _, seed, count in recorder.draws if seed >= boundary]
    trained = [count for _, seed, count in recorder.draws if seed < boundary]
    assert scored == [optimism_scenario.studies.scenarios] * STUDY_SEEDS
    # Exact, with multiplicity and in order: a set comparison would pass an
    # implementation that drew one seed's rung twice and another's not at
    # all, which is the same hole the `scored` assertion above is closed
    # against.
    assert trained == list(OPTIMISM_LADDER) * STUDY_SEEDS


def test_a_seed_that_does_not_solve_is_skipped_and_never_averaged_in_as_zero(
    bookkeeping_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A hole in the data must not be able to produce the hoped-for answer.

    Averaging a missing weight distance in as 0.0 would pull the control
    arm towards "the two models agree", which is the result the lab is
    looking for. The comparison is against a run over the survivors alone
    rather than against a constant, so it stays true under any
    recalibration; a zero-substituting implementation reports two-thirds of
    that value and fails the first assertion.
    """
    first = bookkeeping_scenario.market.seed
    survivors_only = run_elliptical_study(
        replace(
            bookkeeping_scenario,
            market=replace(bookkeeping_scenario.market, seed=first + 1),
            studies=replace(bookkeeping_scenario.studies, seeds=2),
        ),
        log=log,
    )

    # Call 1 is the first seed's Gaussian CVaR solve, so refusing it drops
    # that seed before its other three solves are attempted.
    monkeypatch.setattr(studies_seeds, "solve_problem", _RefusingSolver(frozenset({1})))
    skipped = run_elliptical_study(bookkeeping_scenario, log=log)

    assert skipped.seeds == 2
    assert skipped.gaussian_weight_distance == pytest.approx(
        survivors_only.gaussian_weight_distance
    )
    assert skipped.fat_tailed_weight_distance == pytest.approx(
        survivors_only.fat_tailed_weight_distance
    )
    assert skipped.divergence_ratio == pytest.approx(survivors_only.divergence_ratio)
    zero_substituted = survivors_only.gaussian_weight_distance * 2.0 / 3.0
    assert skipped.gaussian_weight_distance > zero_substituted


def test_a_study_refuses_to_average_fewer_than_two_seeds(
    bookkeeping_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One survivor is not an average, and the study says so rather than report it."""
    # Calls 1 and 2 are the first solve of the first and second seeds; the
    # numbering closes up because a refused seed makes no further calls.
    monkeypatch.setattr(
        studies_seeds, "solve_problem", _RefusingSolver(frozenset({1, 2}))
    )
    with pytest.raises(SolveError, match="at least 2 seeds"):
        run_elliptical_study(bookkeeping_scenario, log=log)


def test_every_rung_is_averaged_over_the_same_seeds(
    optimism_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A seed that fails at one rung is dropped from all of them.

    The rows of this table are compared with each other — that is the whole
    point of it — and two rows averaged over different seeds are not
    comparable. It is also why `OptimismResult` carries one seed count
    rather than one per row.
    """
    survivors_only = run_optimism_study(
        replace(optimism_scenario, studies=replace(optimism_scenario.studies, seeds=2)),
        log=log,
    )
    assert survivors_only.seeds == 2

    # Six solves: two rungs for each of three seeds. Refusing the last one
    # fails the third seed at its *final* rung, after its first rung has
    # already produced a perfectly good score.
    monkeypatch.setattr(studies_seeds, "solve_problem", _RefusingSolver(frozenset({6})))
    skipped = run_optimism_study(optimism_scenario, log=log)

    assert skipped.seeds == 2
    # The first row must have discarded that seed's completed first rung.
    assert skipped.rows[0].in_sample_cvar == pytest.approx(
        survivors_only.rows[0].in_sample_cvar
    )
    assert skipped.rows[0].gap == pytest.approx(survivors_only.rows[0].gap)


def test_the_in_sample_cvar_is_the_empirical_tail_and_not_the_model_objective(
    optimism_scenario: Scenario, log: Logger
) -> None:
    """The in-sample column is scored, not read off the program that made it.

    This is the one place in either study where a shortcut exists: the
    CVaR program's objective *is* a tail average, so a `_score` that
    reported `solution.objective` would be right almost everywhere and
    would put a model objective in a column the lab promises is an
    independent measurement.

    Almost everywhere is the problem, and it is why this test runs at 610
    scenarios rather than at a shipped rung. Where `(1 - beta) * S` is a
    whole number the two quantities are the same number to solver
    precision — measured at 600 scenarios they differ by 6.6e-14 — so a
    test taken there cannot tell them apart. At 610 the tail share is 30.5,
    the tail is 31 scenarios, and the linear program's optimum stops being
    the average of those 31 losses: measured at the shipped mandate and the
    0.008 headline target, the objective is 0.0182201 against an empirical
    tail of 0.0181063, 1.14e-04 apart.
    """
    scenario = replace(
        optimism_scenario,
        algorithms=replace(
            optimism_scenario.algorithms, scenario_ladder=(FRACTIONAL_TAIL_RUNG,)
        ),
        studies=replace(optimism_scenario.studies, seeds=2),
    )
    objectives: list[float] = []
    empirical: list[float] = []
    for seed in study_seeds(scenario):
        market = draw(
            scenario,
            seed=seed,
            count=FRACTIONAL_TAIL_RUNG,
            mode=scenario.market.mode,
            log=log,
        )
        outcome = solve_problem(
            build_cvar_problem(scenario, market, log=log),
            algorithm=STUDY_ALGORITHM,
            target=scenario.headline_target_monthly,
            log=log,
        )
        assert outcome.solution is not None
        objectives.append(outcome.solution.objective)
        empirical.append(
            empirical_cvar(market.returns, outcome.solution.weights, scenario.cvar_beta)
        )

    # The premise, asserted rather than assumed: this is a state where the
    # two candidates genuinely disagree.
    assert all(
        abs(objective - tail) > FRACTIONAL_TAIL_SEPARATION
        for objective, tail in zip(objectives, empirical, strict=True)
    )

    row = run_optimism_study(scenario, log=log).rows[0]
    assert row.in_sample_cvar == pytest.approx(fmean(empirical))
    assert row.in_sample_cvar != pytest.approx(fmean(objectives))


def test_the_survivor_floor_names_the_study_that_ran_out_of_seeds() -> None:
    """Two seeds pass, one does not, and the message says which study asked.

    The behaviour is asserted rather than the constant: pinning
    `MINIMUM_SURVIVING_SEEDS == 2` restates the implementation, and a
    change to it would move the test in lockstep.
    """
    require_survivors(2, attempted=5, study=studies.STUDY_NAME)
    assert studies.STUDY_NAME != studies_optimism.STUDY_NAME
    for name in (studies.STUDY_NAME, studies_optimism.STUDY_NAME):
        with pytest.raises(SolveError, match=re.escape(name)):
            require_survivors(1, attempted=5, study=name)
