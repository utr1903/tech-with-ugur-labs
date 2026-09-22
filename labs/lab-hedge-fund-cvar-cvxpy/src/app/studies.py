"""The measurement this whole lab exists to make.

**The theorem.** Suppose the return distribution is elliptical — a normal,
a multivariate Student-t, any member of that family. Then for a portfolio
`w` the CVaR at a fixed confidence level has a closed form,

    CVaR_beta(w) = -mu'w + c_beta * sigma(w),

where `mu'w` is the expected return, `sigma(w)` is the standard deviation
of the portfolio's return, and `c_beta` is a constant that depends on the
confidence level and the shape of the family but *not* on `w`. Now hold
the expected return fixed, which is exactly what the lab's return-target
constraint does when it binds. The first term is then a constant, so
minimizing CVaR is minimizing `c_beta * sigma(w)`, so it is minimizing
`sigma(w)`, so it is minimizing variance. The two programs in `model.py`
are the same program. Whatever the constraints are, whatever the
confidence level is, they return the same book.

**Why that is the point and not a footnote.** If the market were Gaussian
this lab would have nothing to say: the fund could run Markowitz, solve a
quadratic program that has been understood since 1952, and get precisely
the portfolio a CVaR linear program would have given it. The entire case
for writing out the Rockafellar-Uryasev reformulation rests on the market
*not* being elliptical — and that is a claim about the world that has to
be measured, not asserted. So the lab measures it, by running the same
comparison twice:

* in `gaussian` mode, where the theorem applies and the two books must
  nearly coincide, which is the control; and
* in `fat_tailed` mode, where the generator's rare one-sided jumps put
  mass in the tail that no covariance matrix can see, and the two books
  must part company.

The ratio of the two distances is the headline number. A control that came
back large would mean the measurement itself is broken — bad targets, a
mismatched constraint set, too small a sample — long before it could mean
the theorem is wrong.

**Why the control is a tolerance and not an equality.** The theorem is
about a distribution; the models are handed a finite matrix drawn from one.
A sample of `S` Gaussian draws is only approximately elliptical, its
sample covariance is not the true one, and its empirical 5% tail is an
average of `(1 - beta) * S` numbers with its own standard error. So the
two books land close together rather than on top of each other, and the
remaining distance shrinks with the sample rather than going to zero at
any fixed size. `studies.elliptical_weight_tolerance` is that measured
ceiling, and it is why the fat-tailed ratio, not the control distance, is
the robust claim: a ratio divides the sampling error out of both arms.

**Matched targets, matched everything else.** Both modes, both models and
every seed solve at `studies.matched_target_monthly` under the identical
mandate. That is what makes the comparison an isolation of distribution
shape: the generator's `gaussian` mode reproduces the fat-tailed mode's
first two moments per name and keeps the same factor loadings, so the
whole covariance matrix matches and the only thing that differs between
the two arms is what happens beyond it.

**What it comes back with.** Measured at the shipped settings — five
seeds, 25,000 scenarios per draw, a matched target of 0.005 monthly:

* the control's mean L1 weight distance is **0.0386**, and per seed 0.0328,
  0.0367, 0.0371, 0.0421 and 0.0444;
* the fat-tailed mode's is **0.1272**, and per seed 0.1208 to 0.1326;
* the divergence ratio is therefore **3.295**.

Out of sample, in the fat-tailed mode, the CVaR book's tail is shallower
than the variance book's by **2.53e-04** of NAV on average and at every
one of the five seeds. In the control the same gap is **-2.44e-05** —
noise either side of zero, which is exactly what the theorem predicts
when the two books are the same book, and why only the fat-tailed gap is
asserted.

Every one of those figures moves with the scenario count. Three seeds at
8,000 scenarios measure a control distance of 0.0659 and a ratio of 2.11
instead, so a smaller sample makes the control look worse and the ratio
smaller, not better. `scenario.yaml` carries the same warning beside the
two thresholds.

This file runs past the ~200-line target the lab holds its modules to, and
the reason is prose rather than code: about 143 lines are executable and
the rest is the theorem and the measurements above. The theorem belongs
beside the study that measures it — it is the reason the study exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import fmean

from app.contracts import Scenario
from app.logging_setup import Logger
from app.market import FAT_TAILED_MODE, GAUSSIAN_MODE
from app.model import build_cvar_problem, build_variance_problem
from app.studies_seeds import (
    draw,
    empirical_cvar,
    optimal_weights,
    out_of_sample_seed,
    require_survivors,
    study_seeds,
)
from app.tailrisk import weight_distance

STUDY_NAME = "elliptical"

# The floor under the control distance when the ratio is formed, so a
# control that came back at machine zero produces a large ratio rather
# than a division by zero. It is never reached at any sample size this lab
# runs: the measured control distance is of the order of 1e-02.
DIVERGENCE_FLOOR = 1e-12


@dataclass(frozen=True)
class EllipticalResult:
    """What the two modes measured, averaged over the surviving seeds.

    `divergence_ratio` is the fat-tailed weight distance over the Gaussian
    one — how many times further apart the two models' books are once the
    tails are heavy and one-sided than they are in the elliptical control.

    A `*_out_of_sample_cvar_gap` is the variance book's CVaR minus the CVaR
    book's, both scored on a matrix neither optimizer saw. Positive means
    the CVaR book has the shallower tail out of sample, which is the claim
    worth making: in sample the CVaR book wins by construction, because
    minimizing that number is what it did.
    """

    gaussian_weight_distance: float
    fat_tailed_weight_distance: float
    divergence_ratio: float
    gaussian_out_of_sample_cvar_gap: float
    fat_tailed_out_of_sample_cvar_gap: float
    seeds: int


@dataclass(frozen=True)
class _ModeArm:
    """One seed measured in one mode."""

    weight_distance: float
    out_of_sample_cvar_gap: float


@dataclass(frozen=True)
class _SeedPair:
    """One seed measured in both modes, or not counted at all."""

    gaussian: _ModeArm
    fat_tailed: _ModeArm


def _arm(scenario: Scenario, *, seed: int, mode: str, log: Logger) -> _ModeArm | None:
    """Solve both models on one seed's market and measure the two gaps.

    Returns `None` if either solve was not optimal, which drops the whole
    seed rather than half of it: a ratio of means taken over two different
    seed sets is not a ratio of anything.
    """
    settings = scenario.studies
    target = settings.matched_target_monthly
    arm_log = log.bind(seed=seed, mode=mode, scenarios=settings.scenarios)

    in_sample = draw(
        scenario, seed=seed, count=settings.scenarios, mode=mode, log=arm_log
    )
    cvar_weights = optimal_weights(
        build_cvar_problem(scenario, in_sample, log=arm_log),
        target=target,
        seed=seed,
        log=arm_log,
    )
    if cvar_weights is None:
        return None
    variance_weights = optimal_weights(
        build_variance_problem(scenario, in_sample, log=arm_log),
        target=target,
        seed=seed,
        log=arm_log,
    )
    if variance_weights is None:
        return None

    scored = draw(
        scenario,
        seed=out_of_sample_seed(seed),
        count=settings.scenarios,
        mode=mode,
        log=arm_log,
    )
    beta = scenario.cvar_beta
    arm = _ModeArm(
        weight_distance=weight_distance(cvar_weights, variance_weights),
        out_of_sample_cvar_gap=(
            empirical_cvar(scored.returns, variance_weights, beta)
            - empirical_cvar(scored.returns, cvar_weights, beta)
        ),
    )
    arm_log.info(
        "Measured one elliptical arm.",
        target=target,
        weight_distance=arm.weight_distance,
        out_of_sample_cvar_gap=arm.out_of_sample_cvar_gap,
    )
    return arm


def _seed_pair(scenario: Scenario, *, seed: int, log: Logger) -> _SeedPair | None:
    """Measure one seed in the control mode and then in the real one."""
    gaussian = _arm(scenario, seed=seed, mode=GAUSSIAN_MODE, log=log)
    if gaussian is None:
        return None
    fat_tailed = _arm(scenario, seed=seed, mode=FAT_TAILED_MODE, log=log)
    if fat_tailed is None:
        return None
    return _SeedPair(gaussian=gaussian, fat_tailed=fat_tailed)


def _survivors(
    scenario: Scenario, seeds: tuple[int, ...], *, log: Logger
) -> tuple[_SeedPair, ...]:
    """Measure every seed and keep the ones that solved in both modes.

    Raises:
        SolveError: If fewer than two seeds survived.
    """
    measured = tuple(
        pair
        for pair in (_seed_pair(scenario, seed=seed, log=log) for seed in seeds)
        if pair is not None
    )
    require_survivors(len(measured), attempted=len(seeds), study=STUDY_NAME)
    return measured


def _average(pairs: tuple[_SeedPair, ...]) -> EllipticalResult:
    """Average the surviving seeds and form the divergence ratio."""
    gaussian_distance = fmean(pair.gaussian.weight_distance for pair in pairs)
    fat_tailed_distance = fmean(pair.fat_tailed.weight_distance for pair in pairs)
    return EllipticalResult(
        gaussian_weight_distance=gaussian_distance,
        fat_tailed_weight_distance=fat_tailed_distance,
        divergence_ratio=fat_tailed_distance / max(gaussian_distance, DIVERGENCE_FLOOR),
        gaussian_out_of_sample_cvar_gap=fmean(
            pair.gaussian.out_of_sample_cvar_gap for pair in pairs
        ),
        fat_tailed_out_of_sample_cvar_gap=fmean(
            pair.fat_tailed.out_of_sample_cvar_gap for pair in pairs
        ),
        seeds=len(pairs),
    )


def run_elliptical_study(scenario: Scenario, *, log: Logger) -> EllipticalResult:
    """Compare the CVaR book with the variance book in both market modes.

    For each seed, and in each mode, this draws an in-sample matrix of
    `studies.scenarios`, solves both models on it at
    `studies.matched_target_monthly`, measures the L1 distance between the
    two books, then draws a disjoint matrix from
    `out_of_sample_seed(seed)` and scores both books' tails on it. The
    results are averaged over every seed whose four solves were optimal.

    Args:
        scenario: The universe, the mandate, `cvar_beta` and `studies`.
        log: Logger for the operation boundary.

    Returns:
        Both modes' mean weight distances, their ratio, both modes' mean
        out-of-sample CVaR gaps, and how many seeds those means cover.

    Raises:
        SolveError: If fewer than two seeds solved to optimality in both
            modes, or if a solver failed outright.
        MarketError: If the generator settings cannot produce a matrix.
        ModelError: If the return matrix does not fit the universe.
    """
    seeds = study_seeds(scenario)
    settings = scenario.studies
    study_log = log.bind(
        study=STUDY_NAME, seeds=len(seeds), scenarios=settings.scenarios
    )
    try:
        study_log.info(
            "Running the elliptical study...",
            target=settings.matched_target_monthly,
            modes=[GAUSSIAN_MODE, FAT_TAILED_MODE],
            solves=len(seeds) * 4,
        )
        pairs = _survivors(scenario, seeds, log=log)
        result = _average(pairs)
    except Exception:
        study_log.exception("Running the elliptical study failed.")
        raise
    else:
        study_log.info(
            "Running the elliptical study succeeded.",
            surviving_seeds=result.seeds,
            gaussian_weight_distance=result.gaussian_weight_distance,
            fat_tailed_weight_distance=result.fat_tailed_weight_distance,
            divergence_ratio=result.divergence_ratio,
            gaussian_out_of_sample_cvar_gap=result.gaussian_out_of_sample_cvar_gap,
            fat_tailed_out_of_sample_cvar_gap=(
                result.fat_tailed_out_of_sample_cvar_gap
            ),
        )
        return result
