# Tail-risk portfolio construction with CVXPY

A long/short equity fund holds 30 names across 6 sectors and is already at its
balance-sheet limit. Its portfolio manager does not ask "how volatile is this
book". She asks "in the worst 5% of months, how much do we lose, and what is the
cheapest book that still earns what we promised". This lab answers that question
as a linear program, checks every number it prints against an independent
recomputation, and then shows where the mean-variance answer to the same
question is different — and why.

Every figure in this lab is a fictional teaching assumption. The tickers are
invented, the alphas are invented, the borrow rates and half-spreads are
invented, and the market is a seeded generator rather than a history. Nothing
here is a real security, a real financing cost, a real execution cost, or advice
of any kind. An in-sample number is not a forecast, and the lab spends a whole
section measuring exactly how far from one it is.

## The desk's question

The fund runs 1.32 of NAV gross — long plus short — against a mandate that caps
it at exactly that. Net exposure is flat, every sector is flat in notional, and
yet the book still carries a market beta of +0.0065, because the long half is
slightly more market-sensitive than the short half. Flat in notional is not flat
in risk, which is why the mandate has a beta band at all.

So the desk starts with nothing to spare. Every new position has to be funded by
closing another, and the question is never "what should we own" but "what should
we trade". The lab's headline solve answers exactly that: given a starting book
`w0`, a required expected net return of 80 basis points for the month, and a
mandate the book is already pressed against, what is tomorrow's book?

## What the lab shows

1. **The Rockafellar–Uryasev reformulation**, written out by hand. Conditional
   value at risk — the average loss in the worst `1 - beta` share of scenarios —
   looks like it needs a sort. It does not: it is the optimum of a linear
   program, and this lab builds that program rather than importing one.
2. **Three independent readings of the same tail average**, agreeing to
   6.4e-12 of NAV at the shipped settings, plus a fourth spelling that is an
   alias of one of them.
3. **A mean-variance control** over the identical constraints, so the comparison
   is two answers to one question rather than two questions.
4. **Shadow prices as a desk price list** — what one more turn of gross, or one
   more basis point of required return, actually costs in tail risk — each one
   confirmed by re-solving the program with its bound nudged.
5. **The elliptical theorem in both directions**: in a Gaussian control market
   the CVaR book and the variance book nearly coincide, and in the fat-tailed
   market they do not.
6. **In-sample optimism**, measured rather than asserted: how much the tail a
   desk reports flatters the tail it delivers, and how fast that shrinks with
   the sample.
7. **A verifier that can refuse the run.** Every reported number is rebuilt from
   the weight vector in NumPy, without reading a single CVXPY object, and a
   disagreement raises instead of printing.

## Run the lab

The container stays running so you can edit the mounted YAML or Python source
and rerun without rebuilding:

```bash
git clone https://github.com/utr1903/tech-with-ugur-labs.git
cd tech-with-ugur-labs/labs/lab-hedge-fund-cvar-cvxpy
docker compose up -d --build
docker compose exec lab sh
python -m app
```

`python -m app` writes six result files and three plots into `output/`, which is
inside the bind mount, and prints the report below. The run takes about 36
seconds; the measurement is in [Runtime](#runtime).

Everything after this point in this section is the real output of that command
at the committed defaults, with the JSON log lines filtered out:

```text
==============================================================================
Long/short equity fund -- 95% CVaR portfolio construction
==============================================================================
  universe         30 names in 6 sectors
  market           fat_tailed, 10000 scenarios, seed 20260920
  out of sample    fat_tailed, 10000 scenarios, seed 20260921
  in-sample digest 44b215b4325dd4f0389360a42102ec8df183cc65c6dfb626324d55c5aaf5d917
  scenario digest  d73f7f45e824f30be290e68f4ceddf1c574fe47b041396c3310103a67e745fc1
  tail             worst 500 of 10000 scenarios
  return target    80.00 bp per month, net of borrow and trading cost

Solve
  status           optimal
  solver           CLARABEL
  wall clock       0.465 s over 24 iterations
  objective        214.59 bp of NAV   (the monthly CVaR the model minimized)

Optimal book, in % of NAV -- 27 of 30 names listed
  a name is listed when its weight or its trade reaches 0.50 of NAV;
  the rest are summed into one row so no mass is hidden.
  name              sector      start     weight      trade
  --------  --------------  ---------  ---------  ---------
  TCH1          technology       6.50       6.73       0.23
  TCH2          technology       4.50       4.50      -0.00
  TCH4          technology      -4.50      -3.33       1.17
  TCH5          technology      -6.50      -0.35       6.15
  HLC1          healthcare       6.50       4.82      -1.68
  HLC2          healthcare       4.50       4.40      -0.10
  HLC3          healthcare       0.00      -2.37      -2.37
  HLC4          healthcare      -4.50      -5.48      -0.98
  HLC5          healthcare      -6.50     -10.33      -3.83
  FIN1          financials       6.50       6.50       0.00
  FIN2          financials       4.50       3.78      -0.72
  FIN4          financials      -4.50      -4.50       0.00
  FIN5          financials      -6.50      -3.14       3.36
  IND1         industrials       6.50       5.81      -0.69
  IND2         industrials       4.50       3.35      -1.15
  IND3         industrials       0.00      -2.53      -2.53
  IND4         industrials      -4.50      -4.75      -0.25
  IND5         industrials      -6.50      -9.30      -2.80
  ENE1              energy       6.50       7.35       0.85
  ENE2              energy       4.50       6.68       2.18
  ENE3              energy       0.00       0.76       0.76
  ENE4              energy      -4.50       2.71       7.21
  ENE5              energy      -6.50      -6.50       0.00
  STP1             staples       6.50       5.48      -1.02
  STP2             staples       4.50       0.03      -4.47
  STP4             staples      -4.50      -6.66      -2.16
  STP5             staples      -6.50      -9.68      -3.18
  --------  --------------  ---------  ---------  ---------
  other            3 names       0.00      -0.17      -0.17
  all             30 names       0.00      -6.19      -6.19
  the last two rows are signed sums, so each column adds up.

Desk limits
  `binding` is measured on the expression named in `written on`, which is what
  the model constrains -- never on the `book` figure beside it. Where a limit
  is written on `l + s` or on `t` those are two different numbers, and only
  the first decides the row. Room left in a row is not spare balance sheet:
  what a limit is worth is its shadow price further down.
  limit                   written on    unit        row        cap  binding       book
  ----------------------  ----------  ------  ---------  ---------  -------  ---------
  gross leverage               l + s    %NAV     132.00     132.00      yes     132.00
  largest single name          l + s    %NAV      10.33      12.00       no      10.33
  largest sector gross         l + s    %NAV      27.39      35.00       no      27.39
  turnover, one way                t    %NAV      50.00      50.00      yes      50.00
  net exposure, upper              w    %NAV      -6.19      10.00       no      -6.19
  net exposure, lower              w    %NAV      -6.19     -10.00       no      -6.19
  sector net, upper                w    %NAV      11.00      11.00      yes      11.00
  sector net, lower                w    %NAV     -11.00     -11.00      yes     -11.00
  market beta, upper               w    beta     0.0200     0.0200      yes     0.0200
  market beta, lower               w    beta     0.0200    -0.0200       no     0.0200

Expected monthly return, recomputed from the weights (bp of NAV)
  gross return             90.69
  borrow cost              -5.67   annual fee / 12 on short notional
  trading cost             -5.02   half-spread on traded notional
  net return               80.00   against a target of 80.00

Tail risk at 95% confidence (bp of NAV per month)
  One draw: this run's 10000 in-sample scenarios, scored against this
  run's 10000 out-of-sample scenarios, for the one book above. `out - in`
  is out of sample minus in sample, so a positive number means the reported
  tail was optimistic. One draw of it carries the sampling noise of both
  estimates and can fall either side of zero; the seed-averaged ladder
  below is where the size of the effect lives.
                             in sample   out of sample       out - in
  ----------------------  ------------  --------------  -------------
  VaR                           132.65          128.15          -4.50
  CVaR                          214.59          213.27          -1.32
  tail scenarios                   500             500            n/a

  Three independent readings of the same number (bp of NAV)
    model objective           214.59
    sum_largest oracle        214.59
    empirical CVaR            214.59
    VaR recovery gap            0.00   over 19 scenarios on the threshold
    signed-split overlap        0.00   %NAV, max_i min(l_i, s_i)
    checks passed                 13 of 13

  How optimistic the in-sample tail is, averaged over 5 seeds (bp of NAV)
  A different estimator from the table above, and the one to read for the
  size of the effect: every row redraws an in-sample matrix of that size for
  each seed and scores the book on that seed's own 25000-scenario
  ruler -- one ruler per seed, held fixed across the rungs so the sample
  size is the only thing moving down a column. Same sign convention, so a
  positive `out - in` is again an optimistic in-sample tail.
    scenarios                in sample   out of sample       out - in
  ----------------------  ------------  --------------  -------------
    500                         159.17          220.74          61.57
    2000                        204.08          219.37          15.29
    8000                        205.79          211.23           5.45

What each desk limit costs, in bp of 95% CVaR
  A shadow price is the rate at which the book's tail loss worsens as that
  limit is tightened. It means something only where the constraint is active,
  and a price near machine epsilon is the absence of a price rather than a
  small one.
  The book itself holds 132.00% of NAV gross, which is its own sum |w|.
  The gross cap is 132.00%, and the model writes it on sum(l + s) --
  a different expression, never below sum |w|. Do not subtract the two:
  the difference is gross the book chose not to hold, not room the row is
  leaving it. And the room the row does have left is not capacity either,
  because an inflated leg pads that row while holding nothing. What says
  whether balance sheet is scarce is the gross_leverage price below.
  limit                 binding        price                   per                           check
  ------------------  ---------  -----------  --------------------  ------------------------------
  return_target             yes         4.19        1 bp of target         confirmed by a re-solve
  gross_leverage            yes        83.49    1.00 turn of gross         confirmed by a re-solve
  turnover_budget           yes         1.56    10 pts of turnover         confirmed by a re-solve
  beta_upper                yes         0.27     0.01 of beta band         confirmed by a re-solve
  beta_lower                 no         0.00     0.01 of beta band     not binding, so not checked

  Reading the active prices
    one extra basis point of required monthly return costs 4.19 bp of 95% CVaR
    one more turn of gross saves 83.49 bp of CVaR
    10 more points of turnover budget saves 1.56 bp of CVaR
    the neutrality mandate costs 0.27 bp of CVaR at the upper edge, per 0.01 of band

CVaR against mean-variance
  If returns were elliptical -- a normal, a Student-t -- then at a fixed
  expected return, minimizing CVaR and minimizing variance would be the same
  problem. The Gaussian arm below is the control that says the measurement
  works; the fat-tailed arm is the market the fund actually faces.
  seeds averaged                                   5   at 25000 scenarios each
  L1 book distance, gaussian control          0.0386   of NAV
  L1 book distance, fat-tailed                0.1272   of NAV
  divergence ratio                             3.295   fat-tailed distance / control
  out-of-sample CVaR gap, gaussian             -0.24   bp, variance book minus CVaR book
  out-of-sample CVaR gap, fat-tailed            2.53   bp, variance book minus CVaR book
  worst extra CVaR of the variance book         4.16   bp, at a target of 75.00 bp
  targets where both books solved                 22   of the frontier grid

The same program under three algorithms
  scenarios              solver                status  objective bp     seconds   iterations
  -----------  ----------------  --------------------  ------------  ----------  -----------
  500                  CLARABEL               optimal        156.60       0.018           17
  500             HIGHS_SIMPLEX               optimal        156.60       0.021          297
  500                 HIGHS_IPM               optimal        156.60       0.039           29
  2000                 CLARABEL               optimal        210.93       0.065           15
  2000            HIGHS_SIMPLEX               optimal        210.93       0.119          887
  2000                HIGHS_IPM               optimal        210.93       0.217           36
  8000                 CLARABEL               optimal        221.44       0.312           20
  8000            HIGHS_SIMPLEX               optimal        221.44       1.404         3394
  8000                HIGHS_IPM               optimal        221.44       1.080           38

Frontier sweep
  targets swept                                   25
  feasible                                        22
  infeasible                                       3   first unreachable target 91.67 bp, status infeasible
  CVaR at the lowest feasible target          127.25   bp, target 0.00 bp
  CVaR at the highest feasible target         255.40   bp, target 87.50 bp
```

Only the wall-clock columns move between runs. Re-running that command on this
machine reproduced every other character of the block above — the same book, the
same limits, the same prices, the same studies, the same frontier — while the
headline solve came back anywhere between 0.46 s and 0.49 s and the ladder's
timings shifted by a few percent. If a *number* other than a time differs on
your machine, something real is different; see below.

### Reproducing the digests

The `in-sample digest` is a SHA-256 of the return matrix's shape, dtype and
bytes, and it is a *within-machine* determinism check. Two runs of the same
seed on the same machine produce the same digest, and the lab's tests assert it.
Two runs on different machines need not: the same seed on this laptop's host
Python and inside the Linux container produced matrices differing in 20,441 of
300,000 elements, by at most 6.7e-16 in absolute value and 1.1e-12 relative —
last-bit differences from a different BLAS summation order in one matrix
product. Every reported figure above was identical to the printed precision. So
compare digests between your own runs, not against the one printed here.

## Runtime

The whole default run has a 180-second budget. Measured inside the container,
three consecutive runs of `time python -m app`:

| Run | Wall clock |
|---|---|
| 1 | 35.9 s |
| 2 | 36.1 s |
| 3 | 37.1 s |

Median 36.1 s, on an Apple M4 (10 cores) running macOS 26.6.2 and Docker
28.3.2, in a `linux/arm64` container. No default was reduced to reach the
budget: `market.scenarios` is the 10,000 the design called for, the frontier
sweeps 25 targets, the ladder climbs to 8,000 and both studies average 5 seeds
of 25,000 scenarios.

Where the time goes, read off that run's own JSON log inside the container:
the elliptical study 15.3 s, the frontier sweep 9.9 s, the shadow-price table
4.0 s, the algorithm ladder 3.3 s, the optimism study 2.7 s, and the headline
solve itself 0.47 s. Writing the six artifacts, the three plots and the report
together cost 0.26 s. The log's first record to its last is 36.4 s; the rest of
the 37.1 s that `time` reported is interpreter startup and imports.

If you cut something to make it faster, cut `studies.scenarios`
first and `market.scenarios` last — the optimism story is weakest at small
sample sizes, and `studies.elliptical_weight_tolerance` has to be re-measured if
you shrink the studies.

## Understand the inputs

`scenario.yaml` is one complete, editable scenario. The loader accepts exactly
these fields: an unknown key, a missing key, a non-finite number or an
internally inconsistent mandate is refused before anything is built, and the
message names the full path of the offending field, for example
`desk_limits.gross_leverage_max`.

Units, used consistently throughout: weights are signed fractions of NAV, so
0.065 is a long of 6.5% of the fund; returns are simple one-month returns, so
0.008 is +0.8% in a month; `borrow_fee_annual` is an annual rate charged over
the month as `rate / 12`; `half_spread` is a one-off fraction of traded
notional.

| YAML input | What it controls | Units |
|---|---|---|
| `cvar_beta` | Confidence level of the tail the model minimizes. 0.95 means the worst 5%. | fraction |
| `headline_target_monthly` | Required expected net return of the single reported book. | monthly return |
| `returns_csv` | Optional path to your own return history. See [Bring your own return history](#bring-your-own-return-history). | path or null |
| `universe.sectors` | The six sector names. | — |
| `universe.names[].name` / `.sector` | The 30 tickers and their sector. | — |
| `universe.names[].market_beta` | Sensitivity to the market factor. | unitless |
| `universe.names[].alpha_monthly` | Drift on top of the factor model. | monthly return |
| `universe.names[].borrow_fee_annual` | Cost of borrowing the name to short it. | annual rate |
| `universe.names[].half_spread` | One-off cost of trading it, each way. | fraction of notional |
| `universe.names[].start_weight` | The book held today, `w0`. | fraction of NAV |
| `desk_limits.gross_leverage_max` | Cap on long plus short. | fraction of NAV |
| `desk_limits.net_exposure_min` / `_max` | Band on `sum(w)`. | fraction of NAV |
| `desk_limits.beta_min` / `_max` | Band on `market_beta · w`. | beta |
| `desk_limits.name_gross_cap` | Cap on any single name, long or short. | fraction of NAV |
| `desk_limits.sector_net_cap` | Cap on the absolute net of one sector. | fraction of NAV |
| `desk_limits.sector_gross_cap` | Cap on one sector's long plus short. | fraction of NAV |
| `desk_limits.turnover_max` | One-way trading budget for the month. | fraction of NAV |
| `market.mode` | `fat_tailed` (the market) or `gaussian` (the control). | — |
| `market.seed` / `.scenarios` | In-sample draw and its size, `S`. | — |
| `market.out_of_sample_seed` / `.out_of_sample_scenarios` | The disjoint ruler the book is scored on. | — |
| `market.factor_count` | Number of style factors. | — |
| `market.calm_sigma` | Market factor's standard deviation in a calm month. | monthly return |
| `market.stress_probability` / `.stress_mean` / `.stress_sigma` | The stressed regime of the market factor. | fraction, monthly return |
| `market.idiosyncratic_df` / `.idiosyncratic_sigma` | Student-t name noise, rescaled to carry exactly `sigma`. | degrees of freedom, monthly return |
| `market.jump_probability` / `.jump_mean` / `.jump_sigma` | The rare one-sided crash. | fraction, monthly return |
| `market.jump_names` | Which of the 30 names carry jumps. | — |
| `frontier.points` / `.min_target_monthly` / `.max_target_monthly` | The return-target grid behind the frontier chart. | count, monthly return |
| `algorithms.scenario_ladder` | Sample sizes the three algorithms are timed on. | counts |
| `algorithms.objective_relative_tolerance` | How closely the three have to agree before the run continues. | relative |
| `studies.seeds` / `.scenarios` | Seeds averaged over and scenarios per seed in both studies. | counts |
| `studies.matched_target_monthly` | The return target both models are held to when compared. | monthly return |
| `studies.elliptical_weight_tolerance` | Ceiling on the Gaussian control's book distance. | fraction of NAV, L1 |
| `studies.divergence_ratio_min` | Floor on fat-tailed distance divided by control distance. | ratio |
| `tolerances.*` | Slack allowed by each independent check. Every one is calibrated against a measurement recorded beside it. | see the file |

Two fields deserve a warning, and both carry it in the file.

**`headline_target_monthly` may be raised freely and not lowered freely.** At
the shipped 10,000 scenarios the minimum-CVaR book already earns a net 0.003689
a month on its own. Ask for less than that and the return constraint stops
binding, which takes away the premise that makes the signed split below exact —
and the verifier then refuses the run rather than reporting a book whose legs no
longer describe it. The boundary is exactly 0.003689 and the failure is loud:
`VerificationError: relaxation_exact failed`. The
[low-return region](#where-the-relaxation-lapses) section explains the
mechanism, and `frontier.csv` demonstrates the whole region every run without
moving this field.

**`market.seed` and `market.out_of_sample_seed` are consecutive**, 20260920 and
20260921, unlike the studies' own `seed + 10000`. Nothing shipped sweeps them,
but a hand-written loop over `range(seed, seed + n)` would draw the ruler itself
as an in-sample matrix and report a gap of exactly zero that is arithmetic
rather than measurement. Setting the two equal — or passing `--seed 20260921` —
is refused by the loader.

## Follow the derivation

The names below match `model.py` and `model_desk.py`. Let `R` be the `[S, N]`
in-sample return matrix, `w` the signed weight vector, `w0` the starting book,
`b = cvar_beta`, `Msec` the `[K, N]` sector indicator and
`mu = R.mean(axis=0)` the sample mean monthly return.

### Loss, and why the objective is linear in `w`

A scenario's loss is the negative of the portfolio's return in it. Units are
fractions of NAV per month:

$$
\mathrm{loss}_s(w) = -\left(R w\right)_s, \qquad s = 1, \dots, S
$$

This is linear in `w`. Everything downstream depends on that.

### Why variance answers a different question

Minimizing variance treats a 3% gain and a 3% loss as the same event, because
both are the same distance from the mean. A fund that is paid to carry crash
risk does not experience them as the same event. Worse, variance is blind to
*shape*: the generator's rare one-sided jumps have a component standard
deviation of 0.0317, but variances add in quadrature, so bolting that onto a
name already carrying a monthly standard deviation of 0.064 to 0.077 raises its
total by only 0.0068 to 0.0085 — under a percentage point. A covariance matrix
prices that as almost nothing. Meanwhile the chance that at least one of the
eight jump carriers crashes in a month is 1 − 0.998⁸ = 1.59%, and
1.59% / 5% = 0.32, so roughly a third of the worst 5% of months contains a
crash — and the worst 5% is the only place CVaR looks.

### Why value at risk is the wrong tool and CVaR is not

Value at risk at level `b` is the loss that the worst `1 - b` share of scenarios
exceeds. Written as a function of `w` over a finite sample it is a quantile of a
sorted list, which makes it nonconvex and, as an optimization objective,
combinatorial. Conditional value at risk — the *average* loss over that worst
share — is convex, and Rockafellar and Uryasev showed it is the optimum of a
linear program.

### The Rockafellar–Uryasev reformulation

Introduce a free scalar `a` and a nonnegative vector `u` of length `S`. Units:
`a` and the objective are fractions of NAV per month; `u_s` is the amount by
which scenario `s`'s loss exceeds `a`.

$$
\begin{aligned}
\min_{w,\,a,\,u}\quad & a + \frac{1}{(1-b)\,S}\sum_{s=1}^{S} u_s \\
\text{subject to}\quad & u_s \ \ge\ \mathrm{loss}_s(w) - a, && s = 1,\dots,S \\
& u_s \ \ge\ 0, && s = 1,\dots,S
\end{aligned}
$$

At an optimum each `u_s` collapses to $\max(\mathrm{loss}_s(w) - a,\,0)$, the
objective equals the CVaR, and `a` recovers the empirical value at risk. So the
lab gets VaR out of the same solve for free — `var_auxiliary` in the results —
and checks it against a NumPy quantile of the loss vector.

"Recovers" rather than "equals", deliberately. The objective as a function of
`a` alone is flat across the whole interval between the `(k+1)`-th and `k`-th
largest losses, so *every* point of that interval is optimal and which one a
solver returns is its own business. The lab therefore checks containment rather
than equality. At the shipped settings the interval is 3.1e-13 of NAV wide and
at 600 scenarios it is 1.8e-13, so the distinction is invisible until it is not.

It becomes visible when `(1 - b) * S` is not a whole number: `a` is then
contained in the interval rather than sitting at its upper end, and the
program's optimum stops being the plain average of the worst `k` losses. At 610 scenarios and 95% the tail share is 30.5, the
tail is 31 scenarios, and the two readings separate by 1.14e-04 of NAV. Every
sample size the lab ships is a multiple of 20, so the share is whole and the
two agree to 6.4e-12 of NAV at 10,000 scenarios and 6.6e-14 at 600.

The tail count is never computed inline, for a reason worth knowing:
`(1 - 0.95) * 10000` evaluates to `500.00000000000045` in binary floating point,
so a plain `ceil` returns 501 rather than 500 — and 201 at 4,000, 1,251 at
25,000, 26 at 500. `tailrisk.tail_count` owns the one correct implementation and
every module calls it.

### The signed split, and when it is exact

Gross leverage, the per-name cap and the per-sector gross cap are all statements
about `|w|`, which is not linear. The standard fix is to split each weight into
a long and a short leg:

$$
w = l - s, \qquad l \ge 0, \qquad s \ge 0
$$

This is a *relaxation*, not a definition: nothing above stops both legs being
inflated by the same amount, which leaves `w` unchanged and pushes `l + s` above
`|w|`. It is exact at an optimum whenever inflating both legs is strictly worse,
and exactly two things can make it so:

1. a binding gross-leverage, per-name or per-sector cap — all three are written
   on `l + s`, so an inflated pair spends budget the position could have used;
   or
2. a binding return target **together with** a positive borrow fee, since the
   fee is charged on `s` and an inflated pair therefore eats return the book has
   to deliver.

The half-spread is *not* a premise here, which is the easy mistake: it
multiplies the turnover leg, and padding `(l, s)` leaves `w` and therefore the
turnover leg untouched. Switching each term off on its own at 600 scenarios and
a binding 0.006 target: both costs give a per-name overlap of 1.7e-09, the
borrow fee alone gives 2.0e-09, and the half-spread alone gives 1.1e-02 — no
better than charging nothing at all.

`verification.py` measures the lapse on every solved book as
$\max_i \min(l_i, s_i)$ and refuses the run if it exceeds
`tolerances.relaxation_abs`.

### The turnover relaxation

The same shape with different premises. `t` is pinned from below by the trade in
both directions, so `t >= |w - w0|`, with equality only where something pushes
it back down — a binding turnover budget, or a positive half-spread together
with a binding return target:

$$
t \ \ge\ w - w_0, \qquad t \ \ge\ w_0 - w, \qquad t \ \ge\ 0
$$

The mandate's turnover budget binds at every feasible target on the shipped
frontier, so `t` sits on the real trade to 3.0e-12 of NAV at the headline, and
to 9.1e-11 at the 600 scenarios the tests use. That is a fact about this
calibration and not a theorem: widen `turnover_max` to 8.00 and drop the return
target to −0.02, and the worst name's `t` floats 4.3e-02 of NAV above its own
trade. Which is why the verifier recomputes `|w - w0|` from the weights and
prices the trade off that rather than trusting `t`.

### The desk constraints

Every row below is what `model_desk.py` builds, with the same labels. Units are
fractions of NAV, except the beta rows which are in beta.

$$
\begin{aligned}
\texttt{gross\_leverage:}\quad & \textstyle\sum_i (l_i + s_i) \ \le\ \text{gross\_leverage\_max} \\
\texttt{name\_gross\_cap:}\quad & l_i + s_i \ \le\ \text{name\_gross\_cap}, && i = 1,\dots,N \\
\texttt{sector\_gross\_cap:}\quad & \left(M_{\text{sec}} (l + s)\right)_k \ \le\ \text{sector\_gross\_cap}, && k = 1,\dots,K \\
\texttt{turnover\_budget:}\quad & \textstyle\sum_i t_i \ \le\ \text{turnover\_max} \\
\texttt{net\_exposure\_min/max:}\quad & \text{net\_exposure\_min} \ \le\ \textstyle\sum_i w_i \ \le\ \text{net\_exposure\_max} \\
\texttt{beta\_lower/upper:}\quad & \text{beta\_min} \ \le\ \beta^{\top} w \ \le\ \text{beta\_max} \\
\texttt{sector\_net\_lower/upper:}\quad & -\text{sector\_net\_cap} \ \le\ \left(M_{\text{sec}} w\right)_k \ \le\ \text{sector\_net\_cap}
\end{aligned}
$$

And the one row that is not a desk limit — the promise to the investor:

$$
\texttt{return\_target:}\quad
\mu^{\top} w \;-\; \left(\tfrac{\text{borrow\_fee\_annual}}{12}\right)^{\!\top} s
\;-\; \text{half\_spread}^{\top} t \;\ \ge\ \tau
$$

Both costs are **simplifications, stated as such**: borrow is charged on the
short leg over one month at one twelfth of the annual rate, and trading cost is
a one-off per-name half-spread on traded notional. Neither enters the loss
vector, so neither is in the tail — they are charged once, against the return
the book has to deliver. Both are upper bounds on the true cost given the
relaxations above, which is why the exactness check matters.

`τ` is a `cp.Parameter`, not a constant. That is what lets the frontier sweep
compile the program once and re-solve it 25 times by assigning
`built.target.value`.

### Why these limits are tighter than a textbook mandate

They were chosen by measurement so the constraints actually bite at the headline
target, because a shadow price is only worth printing when the constraint it
belongs to is doing something. Loosen the gross cap from 1.32 toward 1.40 and
the beta band stops binding entirely while the gross price falls from 0.0083 to
0.0010 — a factor of 0.0083 / 0.0010 = 8.3. Widen the beta band from ±0.02 to
±0.05 and the headline book's beta runs to +0.0347 with the band nowhere near
binding, so its price goes to zero and only the single most demanding feasible
target still touches it. **That is the mathematics working, not the lab
breaking**, and trying it is a better way to understand duality than reading
about it.

### The mean-variance control

The same constraints, the same return-target parameter, a different objective:

$$
\min_{w}\ w^{\top} \Sigma\, w
\qquad\text{with}\qquad
\Sigma = \tfrac{1}{2}\left(\widehat{\Sigma} + \widehat{\Sigma}^{\top}\right),
\quad \widehat{\Sigma} = \operatorname{cov}(R)
$$

The symmetrization and CVXPY's `psd_wrap` are there because a sample covariance
matrix routinely has a smallest eigenvalue that is a tiny negative number, which
CVXPY would otherwise reject. The variance program has no `a` and no `u`; it is
a quadratic program over the identical feasible set.

## Three readings of the same number, and one alias

The lab reaches the in-sample CVaR of the reported book by three independent
routes and asserts they agree:

1. the linear program's own objective, `a + sum(u) / ((1-b)S)`;
2. an independent minimization of `cp.sum_largest(-(R @ w), k) / k` over the
   identical constraints, solved as its own problem; and
3. an empirical mean of the worst `k` losses, computed in NumPy from the
   extracted weights, with no CVXPY object involved.

At the shipped settings all three read 214.59 bp and agree to 6.4e-12 of NAV.

A fourth *spelling* exists — `cp.cvar(losses, beta)` — and `model_test.py`
checks it lands on the same optimum, but it is an alias rather than a fourth
derivation: CVXPY expands it internally to `sum_largest(samples, (1-b)m) /
((1-b)m)`, which is route 2. Three independent derivations plus one alias, not
four.

## Reading the duals as a price list

A shadow price is the rate at which the book's tail loss worsens as a limit is
tightened by one unit. At the shipped defaults the desk's price list reads:

| Limit | Price | Per | In words |
|---|---|---|---|
| `return_target` | 4.19 bp | 1 bp of required return | promising one more basis point of return costs 4.19 bp of tail |
| `gross_leverage` | 83.49 bp | 1.00 turn of gross | one more turn of balance sheet is worth 83.49 bp of tail |
| `turnover_budget` | 1.56 bp | 10 points of turnover | a bigger trading budget is worth little here |
| `beta_upper` | 0.27 bp | 0.01 of beta band | the neutrality mandate is cheap at the margin |
| `beta_lower` | — | — | inactive: no price, rather than a small one |

Two things to take from that table. First, a price only means something on an
*active* constraint, and the lab decides activity on the expression the model
actually constrains — `l + s` for the three gross rows, `t` for turnover, `w`
for the rest. A number near machine epsilon, like `beta_lower`'s 2.1e-14, is the
absence of a price and not a small one; the console says so rather than printing
`0.00` and letting you guess.

Second, every active price is confirmed by re-solving the program twice with its
right-hand side nudged by `h` and comparing the central difference
$(f(\text{rhs}+h) - f(\text{rhs}-h)) / (2h)$ against the reported dual. Eight
extra full-size solves for five rows is why that table costs 4.0 s of the run,
and why only active rows get them.

## Gaussian against fat tails

If returns were elliptical — a normal, a multivariate Student-t, any member of
that family — then at a fixed expected return, CVaR has the closed form
$-\mu^{\top}w + c_b\,\sigma(w)$ with `c_b` independent of `w`. The first term is
pinned by the binding return target, so minimizing CVaR *is* minimizing
`sigma(w)`, which is minimizing variance. The two programs would be the same
program, whatever the constraints.

So the lab runs the comparison twice, five seeds of 25,000 scenarios each, at a
matched target of 0.005:

| Arm | L1 book distance | Out-of-sample CVaR gap |
|---|---|---|
| `gaussian` control | 0.0386 of NAV | −0.24 bp |
| `fat_tailed` | 0.1272 of NAV | +2.53 bp |
| ratio | 3.295 | — |

The Gaussian arm is the control that says the measurement works: a control that
came back large would mean the experiment is broken long before it could mean
the theorem is wrong. The fat-tailed arm is the market the fund faces, and there
the two books part company by more than three times as much — with the CVaR
book's tail shallower out of sample, on scenarios neither model saw.

**The divergence is carried by the jump channel and essentially only by it**,
and that is measured by switching each channel off on its own rather than
argued from the shape of the generator. Three seeds at 8,000 scenarios, every
other field at its shipped value:

| Arm | Divergence ratio |
|---|---|
| every channel on | 2.108 |
| `jump_probability` → 0 | 0.939 |
| `stress_probability` → 0 | 2.210 |
| `idiosyncratic_df` 5 → 200 | 1.708 |

Only the jump channel is necessary. Without it the ratio falls to 0.939 — below
1.0, which means the two books are no further apart in this market than in the
elliptical control, so there is no divergence left to explain. Removing the
market factor's stressed regime moves the ratio by 2.210 / 2.108 = 1.05, which
is nothing. Flattening the Student-t's tail costs 1.708 / 2.108 = 0.81, about a
fifth of the ratio, and leaves the effect plainly there.

So if you tone the jumps down — say to a 1% chance of an 18% drop — expect the
two books to converge toward each other. That is not the lab breaking. When a
return distribution is close enough to elliptical, minimizing CVaR and
minimizing variance really are the same problem; this lab is a demonstration of
*when they are not*, and it needs a market where they are not.

## In-sample optimism

A book chosen to minimize the average of the worst 500 losses in a sample will
look better on that sample than on any other, because that is exactly what it
was fitted to. Thirty free weights fitted against 25 tail numbers, which is what
a 500-scenario run amounts to, is a lot of freedom.

Averaged over five seeds, each rung redrawing its in-sample matrix and scoring
the resulting book on that seed's own 25,000-scenario ruler:

| In-sample scenarios | Reported CVaR | Delivered CVaR | Gap |
|---|---|---|---|
| 500 | 159.17 bp | 220.74 bp | +61.57 bp |
| 2,000 | 204.08 bp | 219.37 bp | +15.29 bp |
| 8,000 | 205.79 bp | 211.23 bp | +5.45 bp |

At 500 scenarios a desk reading its own optimizer's output is told its worst-5%
month costs 1.59% of NAV when the book delivers 2.21% — the reported figure
understates the delivered one by 61.57 / 159.17 = 39% of itself. By 8,000
scenarios that is 5.45 / 205.79 = 2.6%. The direction is the lesson; the sizes
belong to this generator.

**Do not read the headline row's −1.32 bp as "the in-sample tail was
pessimistic".** That number is one draw: this run's 10,000 in-sample scenarios
against this run's 10,000 out-of-sample scenarios, for one book. It carries the
sampling noise of both estimates and lands either side of zero. Three
independent five-seed samples of that same quantity at 10,000 scenarios measured
seed-to-seed spreads of 4.6, 7.2 and 6.0 bp, and pooling all 14 distinct draws
gives +1.75 ± 1.58 bp — not distinguishable from zero. The seed-averaged ladder
above is where the size of the effect lives; the one-draw table is there to show
you what a single draw of it looks like.

## Where the relaxation lapses

The frontier sweep solves the same mandate at 25 return targets, and the bottom
of it is a region the headline solve deliberately never enters. Where the return
target has slack, nothing in the program penalizes holding a name long and short
at once: the borrow fee and the half-spread live in the return constraint and
charge for nothing while it has room, and the gross cap is inactive too. The
optimal face widens, an interior-point method settles inside it, and the legs
stop describing the portfolio.

The lab *reports* that rather than asserting against it. `frontier.csv` carries
`cvar_split_overlap` per target, and at the shipped 10,000 scenarios 9 of the 25
targets come back padded, by up to 1.4e-02 of NAV, with the first exact one at
0.00375. The hard `relaxation_exact` check stays where it belongs, on the single
headline book.

Two consequences worth knowing before you edit anything:

- **A lowered `headline_target_monthly` aborts the run**, for exactly this
  reason, below 0.003689. The failure is a `VerificationError`, which is the
  verifier working.
- **Which point of a widened optimal face comes back is a property of the
  algorithm.** At a 0.002 target Clarabel returns a book with an overlap of
  1.3e-02 and HiGHS's simplex returns essentially the same book — L1 distance
  1.5e-10 — with an overlap of exactly zero, because a simplex method finishes
  at a vertex. The headline uses Clarabel.

## The cardinality constraint this lab does not have

A real desk would want a cap on the *number* of positions, or a minimum position
size, so the optimizer cannot answer with thirty half-basis-point stubs. Written
honestly that needs a binary indicator per name and a big-M link to the weight,
which turns this linear program into a mixed-integer one.

The lab names that trade-off instead of implementing it, and the reason is not
laziness. Every guarantee here rests on the problem being a convex program:
solver status means what it says, the shadow prices exist and mean what the
price-list section claims, the three-way objective agreement is a real check
rather than a coincidence of three heuristics, and the frontier's `infeasible`
rows are proofs of infeasibility rather than a search giving up. A cardinality
constraint forfeits all of that at once — duals of a mixed-integer program are
not shadow prices of the original problem, and a gap-limited branch-and-bound
run is not an optimum. Adding one is a legitimate thing to do; it is just a
different lab, with a different set of things it can claim.

## Read the result files

Six files and three plots land in `output/`. Every float is written with `repr`
— the shortest string that reads back as the same double — and nothing is
rounded, so the CSVs are the raw numbers and the console is the readable ones.

They land together or not at all. An unreachable headline target or a failed
check ends the run before any writing starts, on exit code 3 or 4, so a
directory never holds half a run. The writers themselves can serialize a bundle
with no book — the weight tables would hold their header row alone and
`solution.json` a null weight vector, so "no book" could never be read as "the
zero book" — but the orchestration stops first, and the reason reaches you
through the log rather than through a file.

| File | What it holds |
|---|---|
| `solution.json` | Everything: the scenario digest, both markets, the solve verbatim, every verification figure and check, the frontier, the ladder, the duals, both studies, the resolved solver versions and the tolerances. |
| `weights.csv` | One row per name: start weight, solved weight, trade, both legs, the name's economics, and `name_gross_used` — which is `l_i + s_i`, the expression the per-name cap is written on, not `abs(w_i)`. |
| `sectors.csv` | One row per sector: net, gross, and `model_gross_row` — `Msec @ (l + s)`, again the model's expression rather than the book's. The two gross columns are deliberately separate. |
| `frontier.csv` | One row per swept target: both books' statuses verbatim, the CVaR book's objective, its own `sum abs(w)`, the row `sum(l + s)`, the split overlap, and the variance book scored on the same tail. |
| `algorithms.csv` | One row per (scenario count, algorithm): status, objective, wall clock, iterations. |
| `duals.csv` | One row per priced constraint: which expression it is written on, whether it is active, the raw dual, the finite difference, and which of four situations produced the verdict. |
| `frontier.png` | Both books on one CVaR axis against the return target, with the mandate's ceiling marked. |
| `loss_distribution.png` | The in-sample loss histogram with the worst 5% shaded and VaR and CVaR marked. |
| `exposures.png` | Per-sector net and gross against the mandate's caps. |

Every artifact is serialized in full before any existing file is touched, then
written through a temporary sibling, so a failed run leaves the previous results
intact. The final replacements are sequential rather than one transaction, so
use separate `--output` directories if you want to keep several runs.

The `verification` block inside `solution.json` carries names like
`gross_leverage` and `turnover` while holding the **book's own** quantities,
rebuilt from the weight vector. Those bound the constraints' left-hand sides
from below rather than being them; the rows the model actually constrains live
in `duals[]`, `weights.csv` and `sectors.csv` as noted above.

## Read the implementation

Follow the data in this order:

```text
scenario.yaml -> scenario.py -> validation.py -> market.py -> model.py
   -> solver.py -> verification.py -> frontier.py / algorithms.py / duals.py
   -> studies.py -> artifacts.py / console.py / plots.py
```

`scenario.py` parses and freezes the inputs; `validation.py` and
`validation_settings.py` hold every semantic rule. `market.py` draws the seeded
factor model and `market_moments.py` derives its closed-form moments.
`model.py` builds the three programs and `model_desk.py` holds the constraint
block they share — that file is where the derivation above lives as code.
`solver.py` runs one built problem under one named algorithm and reports the
status verbatim. `verification.py`, with `verification_checks.py` and
`verification_exposures.py`, recomputes every figure from the weights alone.
`commands/run.py` coordinates one run in the one order that works, and
`__main__.py` parses arguments and maps failures to exit codes.

## Bring your own return history

`returns_csv.py` reads a CSV whose header names every universe column in the
universe's own order, followed by one row of simple one-month returns per
period, and turns it into exactly the matrix the model consumes. Parsing is
strict on purpose: a silently reordered column would swap two companies'
returns, which in a long/short book means pricing a long as a short.

**The default run does not read it.** `commands/run.py` draws both its in-sample
matrix and its disjoint out-of-sample ruler from the seeded generator, and one
history cannot supply both without a holdout convention this lab does not
define. To point the model at your own data, replace the in-sample draw in
`commands/run.py`:

```python
market = load_returns_csv(scenario.returns_csv, scenario.universe, log=log)
```

and decide for yourself what the out-of-sample matrix should be — a held-back
block of the same file is the usual answer. Two conditions the file has to meet:
its columns must be the 30 names in order, and `(1 - cvar_beta) * rows` must be
a whole number, or the `sum_largest` oracle declines to be built rather than
quietly comparing two different quantities. The seed-averaged studies and the
algorithm ladder always redraw from the generator, because both need many
independent samples and a single history cannot provide them.

## Command line and exit codes

```bash
python -m app --help
python -m app --scenario scenario.yaml --output output --mode gaussian --seed 7
```

`--mode` overrides `market.mode` for both matrices; `--seed` overrides
`market.seed` for the in-sample draw only. Omit either to keep the file's own
value. `uv run app` is equivalent to `python -m app`.

| Exit code | Meaning |
|---|---|
| `0` | A verified result. Artifacts, plots and report written. |
| `1` | Any other deliberate failure — a solver error, a disagreement between algorithms, an artifact that could not be written. |
| `2` | Invalid input: a bad scenario file, an unknown field, an inconsistent mandate, or an override that breaks a rule. Argparse also uses `2` for bad command syntax. |
| `3` | The mandate cannot reach `headline_target_monthly`. Nothing is written. |
| `4` | A recomputed figure disagreed with the solve. Nothing is written. |

Codes 3 and 4 write no artifacts at all, deliberately: an unreachable target and
a failed check are both results, and both are recorded in the JSON log with the
solver's own status verbatim, but neither is a book anyone should read.

## Setup and troubleshooting

You need Git and Docker with Docker Compose v2. Docker Desktop works on macOS
and Windows. The first build needs internet access to pull the pinned Python
image and the locked packages; after that the lab needs no host Python at all.

The image pins Python 3.12.14 and uv 0.12.17 by exact version and the base image
by `@sha256:` digest, smoke-tested on `linux/arm64` and `linux/amd64`.
Application and development versions are pinned in `pyproject.toml` and
`uv.lock`. The run records what it actually resolved: cvxpy 1.9.3, clarabel
0.11.1, highs 1.15.1, numpy 2.5.3 and scipy 1.18.1 in the container above, with
`cvxpy.installed_solvers()` reporting `CLARABEL, SCS, SCIPY, HIGHS, OSQP`.

Dependencies are installed outside the bind mount at `/opt/venv`, so editing
source on the host takes effect on the next run without a rebuild. Changing
`pyproject.toml`, `uv.lock` or the `Dockerfile` needs
`docker compose up -d --build` again.

`LOG_LEVEL` defaults to `info` and every operation logs its entry, success and
failure as JSON on stdout; `.env.example` documents it along with
`UV_PROJECT_ENVIRONMENT`, `PYTHONPATH` and `MPLBACKEND`. Set `LOG_LEVEL=warning`
if you want the report alone.

- **Docker will not start.** Confirm the daemon is running and
  `docker compose version` works.
- **A run exits 2.** Read the last JSON log line: the message names the full
  path of the offending field, for example `desk_limits.gross_leverage_max`.
- **A run exits 3.** The return target is above what the mandate can reach on
  this sample — at the shipped settings the ceiling is 0.008882 a month. Lower
  the target toward 0.008, or loosen a limit.
- **A run exits 4 with `relaxation_exact failed`.** You have almost certainly
  lowered `headline_target_monthly` below 0.003689. See
  [Where the relaxation lapses](#where-the-relaxation-lapses).
- **Your digests differ from the ones printed above.** Expected on a different
  machine; see [Reproducing the digests](#reproducing-the-digests).

Stop the lab with:

```bash
docker compose down
```

## Developer checks

With Python 3.12 and the pinned uv available on the host:

```bash
uv sync --frozen
uv run pytest src/app -q
uv run ruff check src
uv run ruff format --check src
uv run mypy
uv run deptry .
```

291 tests, colocated with the modules they cover under `src/app/`. They cover
the scenario loader's rejection tables, the generator's closed-form moments, a
two-name five-scenario instance whose optimum is available on paper, the signed
split's premises switched off one at a time, the three-way objective agreement,
the independent verifier, the artifact writers, the console tables, the plots
and the command line's exit codes. `mypy` runs `--strict`; there is no
`# noqa` and no `# type: ignore` anywhere in the tree.

The end-to-end test runs the real `scenario.yaml` at its shipped settings and is
marked `e2e`, so you can run it alone with `uv run pytest -m e2e` or skip it
with `uv run pytest -m "not e2e"` while iterating.
