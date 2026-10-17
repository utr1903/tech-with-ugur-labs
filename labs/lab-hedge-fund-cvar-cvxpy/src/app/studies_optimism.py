"""How much of the tail a solved book reports is fit rather than risk.

The CVaR program is handed `S` scenarios and told to minimize the average
of the worst `(1 - beta) * S` of them. It does exactly that — and the
number it reports is the average of the worst few rows of the very matrix
it was allowed to choose against. That is not an estimate of the fund's
tail; it is an estimate of the tail plus however much of the sample's own
bad luck the optimizer managed to position itself away from. The same book
scored on a matrix it never saw gives up that advantage, and the
difference between the two is the optimism.

This is the in-sample/out-of-sample gap that turns up wherever a model is
fitted and then scored on its own training data, and it has a specific
shape here worth knowing: the optimizer has `S` scenarios but only
`(1 - beta) * S` of them carry the objective, so a 95% tail of 500
scenarios is chosen against 25 numbers. Thirty free weights fitted against
25 numbers is a lot of freedom, and the gap says so.

**What this study asserts, and what it only reports.** Two directions are
asserted, because they are what the argument needs: the in-sample number
is below the out-of-sample one at every rung, and the gap shrinks as the
scenario count grows. The *sizes* are reported, never asserted — how large
the gap is at a given count depends on the generator's tails, the mandate,
the confidence level and the target, so pinning a magnitude would be
pinning this particular scenario file rather than the phenomenon.

**The out-of-sample matrix is one fixed size at every rung.** It is always
`studies.scenarios`, never the rung's own count, and that is the detail
that makes the column of gaps comparable. Score a 500-scenario book on 500
fresh scenarios and an 8,000-scenario book on 8,000 fresh ones and the two
out-of-sample numbers carry different sampling error, so a shrinking gap
could be the estimator settling down rather than the fit improving.
Holding the ruler fixed leaves the rung's scenario count as the only thing
that varies down the column.

That fixed size has to be generous, not merely fixed. Measured on the
shipped generator with three seeds, the shipped 0.008 headline target and
a ladder of (500, 1500, 4000), moving *only* `studies.scenarios`: the
4,000-scenario rung's gap comes back at **-9.6e-05** when the
out-of-sample matrix is 3,000 scenarios, and at **+3.8e-04**, **+3.3e-04**
and **+5.1e-04** when it is 6,000, 12,000 and 25,000. An out-of-sample
matrix no larger than the rung it scores carries enough sampling error of
its own to swamp the optimism it is there to measure, and the shipped
25,000 against a top rung of 8,000 leaves three times the room.

**Every rung is scored on the same seed set.** A seed that fails to solve
at any rung is dropped from all of them, not just from that row. The rows
are compared with each other — that is the whole point of the table — and
two rows averaged over different seeds are not comparable, which is also
why `OptimismResult` carries one seed count rather than one per row.

**What it comes back with.** At the shipped settings — five seeds, the
ladder (500, 2000, 8000), every book scored on 25,000 fresh scenarios at
the 0.008 headline target:

    scenarios   in sample   out of sample   gap
          500     0.01592         0.02207   +0.00616
        2,000     0.02041         0.02194   +0.00153
        8,000     0.02058         0.02112   +0.00054

At 500 scenarios a desk reading its own optimizer's output would be told
its worst-5% month costs 1.59% of NAV when the book actually delivers
2.21% — the reported number understates the delivered one by 62 basis
points, nearly two fifths of the figure itself. By 8,000 scenarios that
is down to 5 basis points. The direction is the lesson; the sizes belong
to this scenario file.

Those rows are seed averages, and they have to be. Per seed at the same
settings, 3 of the 15 seed-and-rung cells come back negative: seed
20260920 measures -7.7e-04 at 8,000 scenarios, and seed 20260923 measures
-8.0e-04 at 2,000 and -4.0e-05 at 8,000. A single out-of-sample draw has
a worst 5% of its own, and it can happen to flatter a book that never saw
it — the more so at the top of the ladder, where the effect being measured
is smallest. Averaging five seeds is what makes the mean positive at every
rung, and it is why `studies.seeds` is not 1.

This file runs past the ~200-line target the lab holds its modules to, and
the reason is prose rather than code: about 128 lines are executable and
the rest is the argument and the table above.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import fmean

from app.contracts import MarketScenarios, Scenario
from app.logging_setup import Logger
from app.model import build_cvar_problem
from app.studies_seeds import (
    draw,
    empirical_cvar,
    optimal_weights,
    out_of_sample_seed,
    require_survivors,
    study_seeds,
)

STUDY_NAME = "in-sample optimism"


@dataclass(frozen=True)
class OptimismRow:
    """One rung of the ladder, averaged over the surviving seeds.

    `gap` is `out_of_sample_cvar - in_sample_cvar`, so a positive value
    means the book's reported tail was optimistic — the number it was
    chosen to minimize is better than the number it actually delivers on
    scenarios it never saw.
    """

    scenarios: int
    in_sample_cvar: float
    out_of_sample_cvar: float
    gap: float


@dataclass(frozen=True)
class OptimismResult:
    """The whole table, and the seed count every row of it shares."""

    rows: tuple[OptimismRow, ...]
    seeds: int


@dataclass(frozen=True)
class _SeedScore:
    """One seed's book at one rung, scored on both matrices."""

    in_sample_cvar: float
    out_of_sample_cvar: float


def _score(
    scenario: Scenario,
    scored: MarketScenarios,
    *,
    seed: int,
    count: int,
    log: Logger,
) -> _SeedScore | None:
    """Solve at one rung and score the book on both matrices.

    Both numbers come from `tailrisk`, not from the model objective. At an
    integer tail count the in-sample pair agree to solver precision, and
    taking both through the same function is what makes the difference
    between them a property of the two matrices rather than of two
    different definitions of a tail average.
    """
    rung_log = log.bind(seed=seed, scenarios=count)
    in_sample = draw(
        scenario, seed=seed, count=count, mode=scenario.market.mode, log=rung_log
    )
    weights = optimal_weights(
        build_cvar_problem(scenario, in_sample, log=rung_log),
        target=scenario.headline_target_monthly,
        seed=seed,
        log=rung_log,
    )
    if weights is None:
        return None

    beta = scenario.cvar_beta
    score = _SeedScore(
        in_sample_cvar=empirical_cvar(in_sample.returns, weights, beta),
        out_of_sample_cvar=empirical_cvar(scored.returns, weights, beta),
    )
    rung_log.info(
        "Scored one book in and out of sample.",
        in_sample_cvar=score.in_sample_cvar,
        out_of_sample_cvar=score.out_of_sample_cvar,
        out_of_sample_scenarios=int(scored.returns.shape[0]),
        gap=score.out_of_sample_cvar - score.in_sample_cvar,
    )
    return score


def _seed_ladder(
    scenario: Scenario, *, seed: int, log: Logger
) -> tuple[_SeedScore, ...] | None:
    """Score one seed at every rung, or drop it from the table entirely.

    The out-of-sample matrix is drawn once, before the ladder, and reused
    at every rung: it is the fixed ruler the module docstring describes,
    and drawing it once is also what keeps the study's cost in the solves
    rather than in the generator.
    """
    scored = draw(
        scenario,
        seed=out_of_sample_seed(seed),
        count=scenario.studies.scenarios,
        mode=scenario.market.mode,
        log=log,
    )
    scores: list[_SeedScore] = []
    for count in scenario.algorithms.scenario_ladder:
        score = _score(scenario, scored, seed=seed, count=count, log=log)
        if score is None:
            return None
        scores.append(score)
    return tuple(scores)


def _survivors(
    scenario: Scenario, seeds: tuple[int, ...], *, log: Logger
) -> tuple[tuple[_SeedScore, ...], ...]:
    """Keep the seeds that solved at every rung.

    Raises:
        SolveError: If fewer than two seeds survived.
    """
    measured = tuple(
        scores
        for scores in (_seed_ladder(scenario, seed=seed, log=log) for seed in seeds)
        if scores is not None
    )
    require_survivors(len(measured), attempted=len(seeds), study=STUDY_NAME)
    return measured


def _row(
    count: int, index: int, survivors: Sequence[tuple[_SeedScore, ...]]
) -> OptimismRow:
    """Average one rung across the seeds that survived every rung."""
    in_sample = fmean(scores[index].in_sample_cvar for scores in survivors)
    out_of_sample = fmean(scores[index].out_of_sample_cvar for scores in survivors)
    return OptimismRow(
        scenarios=count,
        in_sample_cvar=in_sample,
        out_of_sample_cvar=out_of_sample,
        gap=out_of_sample - in_sample,
    )


def run_optimism_study(scenario: Scenario, *, log: Logger) -> OptimismResult:
    """Measure the in-sample tail's optimism at every rung of the ladder.

    For each seed, this draws one out-of-sample matrix of
    `studies.scenarios` and then, at every count in
    `algorithms.scenario_ladder`, draws an in-sample matrix of that count,
    solves the CVaR program on it at `headline_target_monthly`, and scores
    the resulting book's tail on both matrices.

    Args:
        scenario: The universe, the mandate, `cvar_beta`, the headline
            target, `algorithms.scenario_ladder` and `studies`.
        log: Logger for the operation boundary.

    Returns:
        One row per rung, in the order the ladder lists them, each
        averaged over the same set of surviving seeds.

    Raises:
        SolveError: If fewer than two seeds solved at every rung, or if a
            solver failed outright.
        MarketError: If the generator settings cannot produce a matrix.
        ModelError: If the return matrix does not fit the universe.
    """
    seeds = study_seeds(scenario)
    ladder = scenario.algorithms.scenario_ladder
    study_log = log.bind(study=STUDY_NAME, seeds=len(seeds), rungs=len(ladder))
    try:
        study_log.info(
            "Running the in-sample optimism study...",
            scenario_counts=list(ladder),
            out_of_sample_scenarios=scenario.studies.scenarios,
            target=scenario.headline_target_monthly,
            solves=len(seeds) * len(ladder),
        )
        survivors = _survivors(scenario, seeds, log=log)
        rows = tuple(
            _row(count, index, survivors) for index, count in enumerate(ladder)
        )
    except Exception:
        study_log.exception("Running the in-sample optimism study failed.")
        raise
    else:
        result = OptimismResult(rows=rows, seeds=len(survivors))
        study_log.info(
            "Running the in-sample optimism study succeeded.",
            surviving_seeds=result.seeds,
            gaps=[row.gap for row in result.rows],
        )
        return result
