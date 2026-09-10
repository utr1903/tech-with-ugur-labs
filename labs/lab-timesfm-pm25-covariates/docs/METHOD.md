# Method

How this lab measures what a covariate is worth, and why each processing step
is there. The README shows you how to run it; this explains what it is doing
and where it could mislead you.

## 1. The question

TimesFM 3.0 forecasts a series from its own history with no training step. It
also accepts *covariates* — other series that might explain the target. The
question here is narrow and empirical:

> On a real, physically driven series, how much does feeding TimesFM extra
> variables actually improve a 24-hour forecast?

The answer is a table of errors, not an opinion. A result of "the covariates
bought nothing" is a publishable outcome and is reported as readily as a
positive one — which is why no assertion in the lab requires the covariate
configurations to win. The only performance assertion is that the model beats
a trivial baseline; everything else is measured and reported.

**What would falsify the headline claim:** if `timesfm-past-future` did not
improve on `timesfm-univariate`, the conclusion would simply be that weather
covariates are not worth plumbing in for this target. The experiment is
designed so that outcome is visible rather than hidden.

## 2. The data

One committed snapshot: `data/milan_air_quality_hourly.csv`, 9,504 hourly rows
covering 2025-08-01T00:00 to 2026-08-31T23:00 UTC for Milan (45.4642 N,
9.19 E). Two keyless Open-Meteo endpoints, joined on an identical hourly time
grid (see `data/PROVENANCE.md`).

| Variable | Units | Source | Role |
|---|---|---|---|
| `pm2_5` | µg/m³ | CAMS Europe | **target** |
| `nitrogen_dioxide` | µg/m³ | CAMS Europe | past-only candidate |
| `carbon_monoxide` | µg/m³ | CAMS Europe | past-only candidate |
| `temperature_2m` | °C | ERA5 | past-future candidate |
| `relative_humidity_2m` | % | ERA5 | past-future candidate |
| `wind_speed_10m` | km/h | ERA5 | past-future candidate |
| `precipitation` | mm | ERA5 | past-future candidate |
| `surface_pressure` | hPa | ERA5 | past-future candidate |
| `boundary_layer_height` | m | ERA5 | past-future candidate |

**Why Milan.** The Po Valley is a basin ringed by the Alps and the Apennines.
In winter it forms temperature inversions: a lid of warm air traps cold air
below it, the mixing layer collapses, and emissions accumulate for days until
wind or rain clears them. That makes PM2.5 there genuinely *exogenously*
driven — the thing to predict responds to weather, rather than only to its own
history. `boundary_layer_height` is the inversion made numeric: it is the
depth of the layer pollutants get to mix into.

**Why winter.** The backtest runs 2025-12-01 to 2026-02-28 because that is
where the variance is. Measured on this snapshot:

| Window | n | mean | sd | peak |
|---|---|---|---|---|
| Winter (Dec–Feb) | 2,160 | 52.01 | 24.77 | 135.70 |
| Summer (Jun–Aug 2026) | 2,208 | 10.62 | 3.92 | 28.50 |

Forecasting the summer series would be easy and uninformative: it barely
moves. The snapshot deliberately spans 13 months so the window can be moved,
or the contrast checked, without re-fetching.

## 3. The forecasting problem

- **Target:** `pm2_5`, one value per hour.
- **Context:** 512 hours (~21 days) of history ending at the origin.
- **Horizon:** 24 hours ahead of the origin.
- **Origins:** 90, one per day at 00:00 UTC across the winter window.
- **Evaluation:** rolling-origin. Each origin is forecast independently from
  its own context; predictions are compared against the measured values that
  followed.

Rolling origins matter because a single train/test split would give one
sample of forecast skill. Ninety origins spanning three months average over
episodes, calm spells, weekends and holidays. Nothing is refit between
origins — there is nothing to refit (§6).

Geometry is enforced, not assumed: `windows.build_windows` raises
`WindowError` if an origin lacks a full 512-hour context or a full 24-hour
horizon inside the snapshot, so a silently truncated window cannot enter the
scoreboard.

## 4. What a covariate is, and the distinction that drives the lab

A **covariate** is a series other than the target that the model may condition
on. TimesFM 3.0 splits them by *what you can know at forecast time*:

- **`past_only_covariates`** — measured up to the origin and no further. You
  know yesterday's NO₂; you do not know tomorrow's.
- **`past_future_covariates`** — known for the horizon as well. Tomorrow's
  weather qualifies, because a weather forecast genuinely exists.

That distinction is the entire point, because on this dataset the most
predictive variables are exactly the ones you cannot know in advance. Pearson
correlation with `pm2_5` over all 9,504 hours:

| Variable | r | Knowable in advance? |
|---|---|---|
| `carbon_monoxide` | **+0.923** | ✗ |
| `nitrogen_dioxide` | **+0.793** | ✗ |
| `temperature_2m` | −0.654 | ✓ |
| `relative_humidity_2m` | +0.572 | ✓ |
| `boundary_layer_height` | −0.419 | ✓ |
| `wind_speed_10m` | −0.347 | ✓ |
| `surface_pressure` | +0.144 | ✓ |
| `precipitation` | −0.097 | ✓ |

CO and NO₂ are near-proxies for PM2.5 because they share its sources — traffic
and heating — and its dispersion physics. They are useless as future
covariates and are offered only as past-only ones.

Two caveats on this table. First, correlation is linear and contemporaneous;
it says nothing about lagged or nonlinear structure, which is what the model
is actually able to exploit. Under a `log1p` transform the dispersion
variables strengthen considerably — `boundary_layer_height` to **−0.593** and
`wind_speed_10m` to **−0.403** — which is consistent with the physical picture
that PM2.5 scales roughly inversely with mixing volume rather than linearly.
Second, `precipitation` and `surface_pressure` are individually near-useless
by this measure, yet they are passed anyway: they are cheap, they are
genuinely forecastable, and whether the model finds joint structure in them is
part of what is being measured.

**Feeding the model a covariate is not the same as the covariate helping.**
Section 9 is how that gets measured.

## 5. Preprocessing, operation by operation

### 5.1 Frame to array

`windows.context_block` and `windows.horizon_block` slice the pandas frame and
hand numpy arrays to the model:

```python
block = frame[list(columns)].to_numpy()[start:stop]
return np.ascontiguousarray(block.T, dtype=np.float32)
```

Three things happen, each deliberate:

- **`.to_numpy()`** drops the index and dtypes into a plain array. pandas is
  the right tool for aligning two endpoints on a time grid; it is the wrong
  tool for feeding a tensor library.
- **`.T`** transposes from pandas' `(time, channels)` to the `(channels,
  time)` layout the model expects. Getting this backwards would not error —
  it would silently forecast a transposed nonsense series.
- **`np.ascontiguousarray(..., dtype=np.float32)`** forces a C-contiguous
  float32 buffer. The transpose produces a *view* with non-contiguous strides;
  materialising it once here avoids a hidden copy inside the model, and
  float32 is what the checkpoint runs in. Handing it float64 would cost a
  conversion per call for precision the model does not use.

The **target context stays 1-D** (`windows.target_context` returns
`context_block(...)[0]`). This is not cosmetic: TimesFM keys its output rank
off its input rank. A 1-D context of length 512 yields a `(24,)` forecast and
`(24, 9)` quantiles; a 2-D `(1, 512)` context would yield `(1, 24)` and
`(1, 24, 9)` and quietly change every downstream shape.

### 5.2 Standardising covariates

```python
context = block[:, :n_context]
mean = context.mean(axis=1, keepdims=True)
sd = np.maximum(context.std(axis=1, keepdims=True), _MIN_SD)
return ((block - mean) / sd).astype(np.float32)
```

**Why standardise at all.** Surface pressure sits near 1000 hPa; precipitation
is usually 0.0. Passed raw, channels with the largest numeric magnitude
dominate whatever the model does internally, for reasons that are an artefact
of units rather than of physics. Per-channel z-scoring puts every covariate on
a common scale, so a millibar and a millimetre are compared on their variation
rather than their magnitude.

**`axis=1` with `keepdims=True`** computes one mean and one standard deviation
*per channel* — a `(channels, 1)` column that broadcasts back across time.
Using `axis=0` would standardise across channels at each timestep, mixing
pressure with rainfall, which is meaningless.

**The statistics come from the context hours only.** This is the subtle part.
A past-future covariate block extends `n_context + horizon` columns, but
`block[:, :n_context]` restricts mean and standard deviation to the pre-origin
portion. Computing them over the full block would fold information about the
horizon — the future — into the scaling of the inputs. The forecast would
improve, and the improvement would be an artefact. This lab exists partly to
show what leakage looks like, so it takes care not to commit it accidentally
while doing so.

**`np.maximum(..., _MIN_SD)` with `_MIN_SD = 1e-6`** guards against division
by zero on a channel that is constant across its context window. Without the
floor, `sd = 0` makes the division produce `inf`/`nan`, which propagates into
the forecast and trips the finiteness check.

> This guard is **defensive, and never fires on this snapshot.** Checked
> across all 90 origins, the smallest context standard deviation of any
> covariate channel is 0.043 (`precipitation`) — Milan gets enough winter rain
> that no 512-hour window is completely dry. A drier climate, a shorter
> context, or a genuinely constant channel would trigger it. It is documented
> here rather than quietly relied upon, because an untested guard is a claim,
> not a safeguard.

**The target is not standardised.** It is passed as raw µg/m³, so forecasts
and quantiles come back in µg/m³ and need no inverse transform. Errors are
therefore directly interpretable, and there is no round-trip in which a
scaling bug could hide.

### 5.3 Assembling past-future blocks

```python
block = np.concatenate([context_block(...), horizon_block(...)], axis=1)
```

`axis=1` is the time axis under the `(channels, time)` layout, so this appends
the horizon hours after the context hours for each channel. The result is
`(6, 536)` — six weather variables across 512 + 24 hours.

### 5.4 Padding, and the honesty of `padding_mode="edge"`

TimesFM decodes in patches of 64 steps. A 24-hour horizon is rounded up to 64
internally, and past-future covariates are expected to span `context + 64`.
Our blocks span `context + 24`, leaving 40 hours unaccounted for.

`padding_mode="edge"` repeats the last known value across that gap. The
alternative — supplying 64 real hours of weather — would mean claiming to know
nearly three days ahead when the premise is a one-day forecast. Edge padding
keeps the claim honest at the cost of a flat covariate tail the model
partially ignores.

## 6. There is no fitting step

Nothing in this lab estimates a parameter from data. There is no `fit()`, no
coefficients, no train/validation split, no gradient step, no hyperparameter
search. The 330M-parameter checkpoint is downloaded frozen and every
configuration runs the same weights.

This surprises readers arriving from classical regression, who reasonably ask
which variables got which weights. The answer is that **this lab cannot tell
you** — whatever weighting exists is internal to a pretrained transformer and
is not exposed as an interpretable coefficient.

What *is* under our control is only:

1. **Which channels the model sees** (the six configurations).
2. **How they are scaled** before it sees them (§5.2).
3. **What it is asked to produce** (§7).

So "how much is wind worth?" cannot be answered by reading a weight. It is
answered by **ablation**: run the model with and without a set of covariates,
change nothing else, and measure the difference in error. That is what the
scoreboard is, and it is why every configuration shares one context length,
one horizon, one set of origins and one random-free code path — an ablation is
only interpretable if exactly one thing differs.

## 7. The model call

```python
model.predict_batch(
    contexts=contexts,               # 90 x (512,) raw µg/m³
    horizon=24,
    past_only_covariates=...,        # or None
    past_future_covariates=...,      # or None
    return_quantiles=True,
    use_symmetric_averaging=False,
    make_positive=True,
    sort_quantiles=True,
    padding_mode="edge",
)
```

- **All 90 origins in one call.** `predict_batch` chunks internally by
  `per_core_batch_size` (8). Looping one origin at a time would pay the
  per-call overhead ninety times.
- **`make_positive=True`** clamps forecasts at zero. A negative PM2.5
  concentration is physically impossible, and letting one through would flatter
  MAE nowhere and corrupt the quantile band.
- **`sort_quantiles=True`** enforces monotone quantiles. Without it a model can
  emit a 0.9 quantile below its 0.1 quantile — quantile crossing — which makes
  the coverage statistic meaningless.
- **`use_symmetric_averaging=False`** halves the forward passes. Symmetric
  averaging runs the context in both directions and averages; it is a variance
  reduction the lab trades away for CPU runtime, and the determinism check
  confirms the cheaper path is still bit-reproducible.
- **`padding_mode="edge"`** — §5.4.

`TimesFM3Forecaster` is used rather than `TimesFM3Evaluator`, which the
package README demos, because the evaluator hard-enforces `padding_mode="none"`
(incompatible with a 24-hour horizon) and defaults symmetric averaging on.

## 8. The metrics

With `ŷ` the forecast, `y` the measured value, over all 90 × 24 = 2,160
predicted hours:

**MAE** — `mean(|ŷ − y|)`, in µg/m³. The headline. Interpretable in the units
of the problem, and does not over-weight the rare huge miss.

**RMSE** — `sqrt(mean((ŷ − y)²))`, in µg/m³. Squaring punishes large errors
harder. Reported alongside MAE because a model that is usually good and
occasionally catastrophic is a different proposition from one that is
uniformly mediocre, and MAE alone cannot distinguish them. RMSE ≥ MAE always;
the gap is a measure of error dispersion.

**MASE** — here, `MAE(model) / MAE(seasonal-naive)` on the same origins. Below
1.0 beats the baseline; above loses to it.

> **A naming caveat, stated plainly.** Textbook MASE (Hyndman & Koehler, 2006)
> scales by the *in-sample* one-step naive error. This lab scales by the
> seasonal-naive error on the *same evaluation origins*. That makes it a
> relative MAE rather than MASE as defined in the literature. The choice is
> deliberate — the comparison a reader wants here is "against the baseline on
> this window" — but the number is not comparable to a MASE reported elsewhere.

**Band coverage** — the fraction of measured values falling inside the
0.1–0.9 quantile band. That band is nominally **80%**, so a well-calibrated
model scores near 0.80.

> **The check is loose.** `calibration-sanity` passes anything in 0.60–0.95.
> That range catches a badly broken band, not a mildly miscalibrated one.
> Treat a passing calibration check as "not obviously wrong", not as evidence
> of calibration. The measured values (0.79–0.81) happen to be very close to
> nominal, but the check would not have caught it if they were not.

## 9. The baseline and how to read the scoreboard

**Seasonal-naive** predicts each hour with the value 24 hours earlier. On this
window it scores **MAE 17.83 µg/m³**. It is free, needs no model, and is
harder to beat than it looks: hourly PM2.5 has a strong daily cycle driven by
traffic and heating, so "same hour yesterday" already captures most of the
shape. A foundation model that cannot beat it has no story, which is why that
is the one performance assertion the lab enforces.

Reading the table as an ablation — each row differs from `timesfm-univariate`
in exactly one respect:

| Configuration | Adds | Measured MAE |
|---|---|---|
| `seasonal-naive` | — | 17.83 |
| `timesfm-univariate` | nothing (PM2.5 history only) | 12.08 |
| `timesfm-past-only` | NO₂ + CO up to the origin | 12.17 |
| `timesfm-past-future` | six weather variables through the horizon | 10.14 |
| `timesfm-both` | both of the above | 10.28 |
| `leaky-control` | tomorrow's NO₂ and CO — **cheating** | 6.39 |

The differences are the findings. Weather covariates are worth about 16% of
MAE (12.08 → 10.14). The strongest *correlates* — NO₂ and CO, at +0.79 and
+0.92 — are worth slightly **less than nothing** as past-only covariates
(12.08 → 12.17), and adding them to the weather run makes it slightly worse
(10.14 → 10.28). That is the lab's central result: predictive power you cannot
know in advance is not predictive power you can use.

**`leaky-control` is not a result.** It is handed the future values of NO₂ and
CO — the very thing that is unknowable — and scores 6.39 because it is being
told most of the answer. It exists so that leakage has a visible signature on
a scoreboard, and its assertion is structural: if it did *not* win, the
covariate arguments would not be reaching the model at all, and every other
row would be meaningless. It is a wiring test disguised as a result.

## 10. Threats to validity

Stated because a scoreboard without them invites over-reading.

1. **The training cutoff is unpublished.** TimesFM 3.0's pretraining corpus is
   not disclosed, so it cannot be proven the model never saw Milan air quality
   for this period. A 2026 evaluation window is a reasonable guard, not a proof
   of a clean zero-shot result.
2. **`timesfm-past-future` uses measured weather, not forecast weather.** It is
   the *best case* for these covariates, not leakage — but a real deployment
   would supply a forecast carrying its own error, so the 16% gain is an upper
   bound on what the setup would deliver in production.
3. **One city, one window, one target.** Milan in a single winter. Nothing here
   establishes that the result transfers to a coastal site where the inversion
   story does not apply.
4. **No significance test.** The 90 origins overlap heavily in context and are
   serially correlated, so ordinary confidence intervals do not apply. The
   0.09 µg/m³ gap between `timesfm-univariate` and `timesfm-past-only` is well
   inside what should be treated as noise; the 1.94 gap to
   `timesfm-past-future` is large enough to read as real. Neither claim is
   backed by a test statistic here.
5. **Point forecasts are deterministic, but the band is not validated beyond
   coverage.** Sharpness is not measured; a trivially wide band would also
   score well on coverage alone.
