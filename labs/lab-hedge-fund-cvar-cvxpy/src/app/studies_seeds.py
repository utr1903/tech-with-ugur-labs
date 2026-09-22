"""The seed loop both comparison studies stand on, and the rules it obeys.

One seed is one draw of one market, and either study read off a single
draw would be reporting sampling noise with a straight face. Both average
over `studies.seeds` consecutive seeds starting at `market.seed`. That
averaging is where the honesty rules live, so they live here — once,
rather than once per study, because a rule written out twice is a rule
that drifts.

**Skip, never substitute.** A seed whose solve does not come back
`optimal` contributes nothing to either mean. It is not retried, it is not
softened by accepting `optimal_inaccurate`, and above all it is not folded
in as a zero. Think about what a zero would do: a missing weight distance
averaged in as 0.0 drags the control arm towards "the two models agree",
and a missing tail gap averaged in as 0.0 drags the fat-tailed arm towards
"the two books carry the same tail". Both of those are the answer this lab
would like to see, which is exactly why a hole in the data must never be
able to produce one. The seed is dropped, a warning names it and the
status, and the survivor count is reported beside every mean.

**Two survivors, or nothing.** A mean over one seed is that seed. Below
`MINIMUM_SURVIVING_SEEDS` a study raises rather than publish an average it
never took.

**One ruler.** Every CVaR either study reports is the empirical tail
average from `tailrisk`, recomputed from the weights and a return matrix.
It is never a model objective. The variance program's objective is a
variance and is not on the same axis at all, and `verification.py` is not
a way round that. It is specific to the Rockafellar-Uryasev program, and
handing it a mean-variance solve fails at the *first* check rather than at
the interesting one: the variance model has no auxiliary scalar, the
solver reports NaN for it, and `weights_finite` refuses the outcome long
before anything compares an objective with a tail. Measured on the shipped
mandate at 600 scenarios, the message is `weights_finite failed: 0
non-finite of 30 weights, auxiliary scalar nan`. So the refusal is real
but it says nothing about tails, and putting both books on the same
empirical ruler here is the only thing that makes the difference between
them mean anything.

**Out of sample means a different seed, not a different slice.**
`out_of_sample_seed` moves the draw `OUT_OF_SAMPLE_SEED_OFFSET` seeds away
from the matrix the optimizer saw, so the two share a distribution and
share no scenario. The offset is far larger than any `studies.seeds` this
lab would run, so no seed's out-of-sample matrix can collide with another
seed's in-sample one.
"""

from __future__ import annotations

import cvxpy as cp

from app.contracts import FloatArray, MarketScenarios, Scenario
from app.errors import SolveError
from app.logging_setup import Logger
from app.market import generate_scenarios
from app.model import BuiltProblem
from app.solver import solve_problem
from app.tailrisk import portfolio_losses, tail_statistics

# Clarabel, for the same reason `frontier.py` sweeps with it: the studies
# are dozens of solves and it is the cheap one. Cross-algorithm agreement
# is the ladder's job in `algorithms.py`, where it is the measurement
# rather than an overhead on every other measurement.
STUDY_ALGORITHM = "CLARABEL"

# How far the out-of-sample seed sits from the in-sample one.
OUT_OF_SAMPLE_SEED_OFFSET = 10_000

# The fewest seeds an average may be taken over.
MINIMUM_SURVIVING_SEEDS = 2


def study_seeds(scenario: Scenario) -> tuple[int, ...]:
    """Return the consecutive seeds a study averages over.

    Args:
        scenario: Supplies `market.seed` as the first seed and
            `studies.seeds` as how many follow it.

    Returns:
        `studies.seeds` consecutive integers starting at `market.seed`.
    """
    first = scenario.market.seed
    return tuple(range(first, first + scenario.studies.seeds))


def out_of_sample_seed(seed: int) -> int:
    """Return the seed of the matrix a book drawn from `seed` is scored on."""
    return seed + OUT_OF_SAMPLE_SEED_OFFSET


def draw(
    scenario: Scenario, *, seed: int, count: int, mode: str, log: Logger
) -> MarketScenarios:
    """Draw one return matrix from this scenario's generator settings.

    The three keywords override the matching fields on `market`, which is
    the whole reason `generate_scenarios` takes them separately: a study
    re-draws the same distribution under many seeds, at its own sample
    size, and in both modes.

    Raises:
        MarketError: If `mode` is unknown, `count` is not positive, or the
            settings produce a non-finite matrix.
    """
    return generate_scenarios(
        scenario.universe, scenario.market, seed=seed, count=count, mode=mode, log=log
    )


def optimal_weights(
    built: BuiltProblem, *, target: float, seed: int, log: Logger
) -> FloatArray | None:
    """Solve one built problem and return its weights, or `None` to skip.

    `None` is returned for any status other than `optimal`, including
    `optimal_inaccurate`. That is stricter than the headline solve, which
    reports a nearly-converged book verbatim and lets a reader judge it,
    and the reason is that these numbers are averaged rather than read.
    A book that is nearly right is a perfectly useful thing to look at and
    a bad thing to put into a mean over five seeds, because the mean hides
    which seed it came from.

    Args:
        built: A compiled problem and its variable handles.
        target: The expected net monthly return the book must deliver.
        seed: The seed this problem's matrix was drawn from, for the
            warning if the solve is skipped.
        log: Logger for the solve and for the skip warning.

    Returns:
        The solved weights, or `None` if this seed must be skipped.

    Raises:
        SolveError: If the solver itself failed, as opposed to reporting a
            problem it could not satisfy.
    """
    outcome = solve_problem(built, algorithm=STUDY_ALGORITHM, target=target, log=log)
    if outcome.status != cp.OPTIMAL or outcome.solution is None:
        log.warning(
            "Skipping a seed whose solve was not optimal.",
            seed=seed,
            kind=built.kind,
            status=outcome.status,
            target=target,
        )
        return None
    return outcome.solution.weights


def empirical_cvar(returns: FloatArray, weights: FloatArray, beta: float) -> float:
    """Score one book's tail on one return matrix.

    Raises:
        MarketError: If the matrix and the weights do not fit each other.
        ScenarioError: If `beta` is outside `(0, 1)`.
    """
    return tail_statistics(portfolio_losses(returns, weights), beta).cvar


def require_survivors(survived: int, *, attempted: int, study: str) -> None:
    """Refuse to average fewer seeds than a mean needs.

    Raises:
        SolveError: If fewer than `MINIMUM_SURVIVING_SEEDS` seeds solved.
    """
    if survived < MINIMUM_SURVIVING_SEEDS:
        raise SolveError(
            f"the {study} study needs at least {MINIMUM_SURVIVING_SEEDS} seeds "
            f"whose solves were optimal, and {survived} of {attempted} survived; "
            f"a mean over fewer is not an average of anything"
        )
