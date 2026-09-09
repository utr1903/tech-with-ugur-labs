# Forecasting tomorrow's smog with TimesFM 3.0

TimesFM forecasts a time series with no training and no API key: point it at a
history and it extrapolates. Out of the box, though, it only sees the series
itself. Version 3.0 added native support for covariates - extra channels you
can hand it alongside the target. This lab measures what that support is
actually worth, on hourly PM2.5 in Milan, a city where winter smog is driven by
temperature inversions trapping still air in the Po Valley.

## What this shows

- The distinction that dominates real forecasting: what you will genuinely
  know about the future versus what you only measured in the past.
- In this dataset CO correlates +0.92 with PM2.5 and NO2 +0.79 - the two
  strongest correlates by far - and you cannot know either one in advance.
  Temperature correlates -0.65 and wind -0.35, weaker, but a weather forecast
  hands you both a day ahead of time.
- What an honest rolling-origin backtest looks like, and what target leakage
  looks like when it posts a beautiful score.

## Prerequisites

- Docker with Compose v2
- ~2 GB of disk for the model checkpoint, downloaded once into a named volume
- No API key and no cloud account

## Run it

```bash
cd labs/lab-timesfm-pm25-covariates
docker compose up
```

The first run downloads the TimesFM 3.0 checkpoint (~1.32 GB) into a named
Docker volume - that took about 49 seconds here. Every run after that is
offline. The five model configurations themselves take about 93 seconds total
on a laptop CPU (9s, 11s, 25s, 37s, 11s below); nothing here needs a GPU.

## What you should see

```
90 origins, 512h context, 24h horizon
seasonal-naive MAE: 17.83 ug/m3
timesfm-univariate     MAE  12.08  (9s)
timesfm-past-only      MAE  12.17  (11s)
timesfm-past-future    MAE  10.14  (25s)
timesfm-both           MAE  10.28  (37s)
leaky-control          MAE   6.39  (11s)
saved forecasts to /app/output/forecasts.npz

Scoreboard (PM2.5, ug/m3, 24h ahead)
---------------------------------------------------------------
configuration              MAE    RMSE    MASE  coverage  notes
seasonal-naive           17.83   23.50   1.000         -  Same hour yesterday
timesfm-univariate       12.08   15.79   0.678      0.80  TimesFM on the PM2.5 history alone
timesfm-past-only        12.17   15.82   0.683      0.79  Plus measured NO2 and CO up to the origin, and no further
timesfm-past-future      10.14   13.02   0.569      0.81  Plus tomorrow's weather, the way a real forecast would have it
timesfm-both             10.28   13.16   0.577      0.81  Past pollutants and future weather together
leaky-control             6.39    8.53   0.359      0.81  CHEATS *

MASE is MAE relative to seasonal-naive: below 1.0 beats it.
* leaky-control is given tomorrow's NO2 and CO. Its score is what target leakage looks like, not a result.

wrote /app/output/smog_episode.png

Checks
------
[PASS] snapshot-integrity: 9504 contiguous hourly rows, no nulls, one aligned grid
[PASS] shapes-and-finiteness: all 6 configurations produced finite 90x24 forecasts
[PASS] beats-the-baseline: timesfm-univariate MAE 12.08 vs seasonal-naive 17.83 ug/m3
[PASS] leakage-is-visible: leaky-control MAE 6.39 vs best honest 10.14 ug/m3 - if this fails, the covariate arguments are being ignored
[PASS] calibration-sanity: 0.1-0.9 band covers 0.79-0.81 of actuals
[PASS] determinism: two runs over 8 origins produced bit-identical point forecasts

all checks passed
```

`output/smog_episode.png` plots the worst 24-hour episode in the backtest
window - the one starting 2025-12-15, peaking at 136 ug/m3. It is not
flattering: every configuration badly underestimates that peak, and the
0.1-0.9 uncertainty band misses it for most of the episode. That is included on
purpose. A cherry-picked good day would tell you less about whether to trust
this on your own data than the model's actual worst showing does.

## What the covariates were actually worth

Tomorrow's weather is worth about 16% of MAE: 12.08 down to 10.14, MASE 0.678
down to 0.569. That is the single biggest honest gain in the table.

Yesterday's NO2 and CO are worth nothing at all: 12.08 to 12.17, very slightly
*worse* than using PM2.5 alone. Stacking those past-only covariates on top of
the weather costs a little too: 10.14 to 10.28 for `timesfm-both`.

That split lines up with the correlations, but not the way "most predictive"
would suggest. CO and NO2 are the strongest correlates of PM2.5 in this
dataset (+0.92 and +0.79) and both are useless here, because you cannot know
either one in advance - `timesfm-past-only` can only ever see them up to the
forecast origin. Temperature (-0.65), relative humidity (+0.57), boundary
layer height (-0.42) and wind speed (-0.35) all correlate more weakly, but a
weather forecast genuinely hands you all four a day ahead, and together they
are what buys the 16%. "Most predictive" and "actually knowable" are different
questions, and only the second one pays.

`leaky-control` is the deliberately cheating configuration: it is handed
tomorrow's NO2 and CO as if they were forecastable, the way `timesfm-both`
is handed tomorrow's weather. Its MAE of 6.39 - well below every honest
configuration - is not a result, it is what target leakage looks like on a
scoreboard. If this number is *not* far ahead of the honest configurations,
that is a sign the covariate arguments are being ignored rather than a sign
the model is fair.

## How it works

Three stages, run in order by `main.py run` (the container's default
command):

1. **fetch** - pulls hourly PM2.5, NO2 and CO plus six weather variables for
   Milan from Open-Meteo and writes one aligned, null-checked CSV. Already
   done: the committed snapshot in `data/` covers 2025-08-01 through
   2026-08-31, and `data/PROVENANCE.md` has the source detail. Re-running it
   reproduces the same file, because both endpoints serve archive/reanalysis
   data for past dates, which does not change.
2. **backtest** - walks 90 daily forecast origins across the winter window
   (2025-12-01 to 2026-02-28), each with 512 hours of context and a 24-hour
   horizon, and runs six configurations over every origin:
   - `seasonal-naive` - same hour yesterday, no model
   - `timesfm-univariate` - TimesFM on the PM2.5 history alone
   - `timesfm-past-only` - plus measured NO2 and CO up to the origin, no
     further
   - `timesfm-past-future` - plus tomorrow's weather, the way a real forecast
     would have it
   - `timesfm-both` - past pollutants and future weather together
   - `leaky-control` - the cheat described above, included to show what
     leakage looks like rather than to be a real option

   One detail worth knowing if you read `forecast.py`: a 24-hour horizon is
   rounded up internally to TimesFM's 64-step output patch. The past-and-future
   covariate blocks are edge-padded over that difference rather than pretending
   to know 64 hours of weather.
3. **report** - renders the scoreboard, plots the worst episode, and runs six
   hard checks (snapshot integrity, output shapes and finiteness, beating the
   baseline, leakage being visible, calibration, and determinism). Whether the
   *honest* covariate configurations beat the univariate one is reported in
   the scoreboard, deliberately not asserted as a check - that is the question
   the lab is asking, and enforcing an answer to it would make the answer
   worthless.

## Running the tests

```bash
docker compose run --rm lab python -m pytest -v -m "not slow"
```

## Refreshing the data

```bash
docker compose run --rm lab python main.py fetch
```

## Clean up

```bash
docker compose down -v   # -v also drops the cached model checkpoint
```

## Licensing and attribution

**The TimesFM 3.0 model weights are licensed under
`timesfm-non-commercial-license-v1.0` - non-commercial, non-production use
only.** This lab, and anything you build against these weights, inherits that
restriction. The TimesFM source code and the weights up to version 2.5 are
Apache-2.0; if you need commercial use, the route is TimesFM 2.5's weights
plus its XReg covariate wrapper, not 3.0.

Data (c) [Open-Meteo](https://open-meteo.com/), licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Air quality data is
produced by the Copernicus Atmosphere Monitoring Service (CAMS); weather data
is ERA5 reanalysis. See `data/PROVENANCE.md` for the exact endpoints and
variables.

## Notes

- Inference here runs on CPU PyTorch, because Docker Desktop cannot reach the
  host's Metal GPU. Natively on Apple silicon, outside a container,
  `pip install timesfm[mlx]` is markedly faster.
- TimesFM's training cutoff is not published. Evaluating on a 2026 window is a
  reasonable guard against the model having already seen this data during
  training, but it is not a proof - there is no published cutoff to check it
  against, so treat "zero-shot" here as a reasonable assumption, not a
  demonstrated fact.
