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
Docker volume - that takes under a minute on a typical connection. Every run
after that is offline. The five model configurations themselves take a bit
over a minute combined on a laptop CPU; nothing here needs a GPU. Exact
timings vary by machine and appear per-configuration in the log below.

Note for anyone scripting this: `docker compose up` does not propagate the
container's exit code, so `echo $?` afterwards reads 0 even if a check
failed inside the container. The in-process gate is sound - a failed check
raises `ChecksFailedError`, and `app.__main__.main` catches it, logs it and
returns 1, so `app run` itself exits 1 - but Compose's own exit code wraps
that up differently; pass `--abort-on-container-exit` if you need the
wrapper to fail too.

## What you should see

Progress is logged as one JSON object per line; a harmless Hugging Face Hub
warning (`Warning: You are sending unauthenticated requests to the HF
Hub...`) shows up plain, mixed in among them - expected, and safe to ignore.
The scoreboard and checks are rendered as plain text underneath. This is a
real run, trimmed of nothing but the Docker build/pull noise above it:

```
{"app_name": "timesfm-pm25-covariates", "path": "/app/data/milan_air_quality_hourly.csv", "event": "Loading the snapshot...", "level": "info", "timestamp": "2026-09-10T09:40:47.626954Z"}
{"app_name": "timesfm-pm25-covariates", "rows": 9504, "event": "Loading the snapshot succeeded.", "level": "info", "timestamp": "2026-09-10T09:40:47.637456Z"}
{"app_name": "timesfm-pm25-covariates", "rows": 9504, "event": "Validating the snapshot...", "level": "info", "timestamp": "2026-09-10T09:40:47.637496Z"}
{"app_name": "timesfm-pm25-covariates", "rows": 9504, "event": "Validating the snapshot succeeded.", "level": "info", "timestamp": "2026-09-10T09:40:47.638518Z"}
{"app_name": "timesfm-pm25-covariates", "origins": 90, "context_hours": 512, "horizon_hours": 24, "event": "Built the backtest windows.", "level": "info", "timestamp": "2026-09-10T09:40:47.648293Z"}
{"app_name": "timesfm-pm25-covariates", "mae": 17.829214096069336, "event": "Scored the baseline.", "level": "info", "timestamp": "2026-09-10T09:40:47.648440Z"}
{"app_name": "timesfm-pm25-covariates", "batch_size": 8, "event": "Building the forecaster...", "level": "info", "timestamp": "2026-09-10T09:40:47.648522Z"}
Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.
{"app_name": "timesfm-pm25-covariates", "checkpoint": "google/timesfm-3.0-pytorch", "event": "Building the forecaster succeeded.", "level": "info", "timestamp": "2026-09-10T09:40:49.486113Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-univariate", "origins": 90, "event": "Forecasting the batch...", "level": "info", "timestamp": "2026-09-10T09:40:49.493630Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-univariate", "event": "Forecasting the batch succeeded.", "level": "info", "timestamp": "2026-09-10T09:40:53.627135Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-univariate", "mae": 12.08474063873291, "seconds": 4.141189668000038, "event": "Scored the configuration.", "level": "info", "timestamp": "2026-09-10T09:40:53.627495Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-past-only", "origins": 90, "event": "Forecasting the batch...", "level": "info", "timestamp": "2026-09-10T09:40:53.642053Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-past-only", "event": "Forecasting the batch succeeded.", "level": "info", "timestamp": "2026-09-10T09:41:03.622284Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-past-only", "mae": 12.172311782836914, "seconds": 9.99609883800008, "event": "Scored the configuration.", "level": "info", "timestamp": "2026-09-10T09:41:03.622922Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-past-future", "origins": 90, "event": "Forecasting the batch...", "level": "info", "timestamp": "2026-09-10T09:41:03.651966Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-past-future", "event": "Forecasting the batch succeeded.", "level": "info", "timestamp": "2026-09-10T09:41:25.424595Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-past-future", "mae": 10.144158363342285, "seconds": 21.802827176999926, "event": "Scored the configuration.", "level": "info", "timestamp": "2026-09-10T09:41:25.425810Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-both", "origins": 90, "event": "Forecasting the batch...", "level": "info", "timestamp": "2026-09-10T09:41:25.466462Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-both", "event": "Forecasting the batch succeeded.", "level": "info", "timestamp": "2026-09-10T09:41:53.494835Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-both", "mae": 10.281707763671875, "seconds": 28.070713429999955, "event": "Scored the configuration.", "level": "info", "timestamp": "2026-09-10T09:41:53.495887Z"}
{"app_name": "timesfm-pm25-covariates", "name": "leaky-control", "origins": 90, "event": "Forecasting the batch...", "level": "info", "timestamp": "2026-09-10T09:41:53.516975Z"}
{"app_name": "timesfm-pm25-covariates", "name": "leaky-control", "event": "Forecasting the batch succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:03.934027Z"}
{"app_name": "timesfm-pm25-covariates", "name": "leaky-control", "mae": 6.3939995765686035, "seconds": 10.440168588000006, "event": "Scored the configuration.", "level": "info", "timestamp": "2026-09-10T09:42:03.934997Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-univariate", "origins": 8, "event": "Forecasting the batch...", "level": "info", "timestamp": "2026-09-10T09:42:03.936957Z"}
{"app_name": "timesfm-pm25-covariates", "name": "timesfm-univariate", "event": "Forecasting the batch succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.292512Z"}
{"app_name": "timesfm-pm25-covariates", "origins": 8, "event": "Ran the determinism repeat.", "level": "info", "timestamp": "2026-09-10T09:42:04.292575Z"}
{"app_name": "timesfm-pm25-covariates", "path": "/app/tmp/forecasts.npz", "event": "Saving the forecasts...", "level": "info", "timestamp": "2026-09-10T09:42:04.292769Z"}
{"app_name": "timesfm-pm25-covariates", "path": "/app/tmp/forecasts.npz", "event": "Saving the forecasts succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.314091Z"}
{"app_name": "timesfm-pm25-covariates", "path": "/app/data/milan_air_quality_hourly.csv", "event": "Loading the snapshot...", "level": "info", "timestamp": "2026-09-10T09:42:04.314825Z"}
{"app_name": "timesfm-pm25-covariates", "rows": 9504, "event": "Loading the snapshot succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.323838Z"}
{"app_name": "timesfm-pm25-covariates", "path": "/app/tmp/forecasts.npz", "event": "Loading the forecasts...", "level": "info", "timestamp": "2026-09-10T09:42:04.335323Z"}
{"app_name": "timesfm-pm25-covariates", "configurations": 6, "event": "Loading the forecasts succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.342857Z"}

Scoreboard (PM2.5, ug/m3, 24h ahead)
---------------------------------------------------------------
configuration              MAE    RMSE    MASE  coverage  notes
seasonal-naive           17.83   23.50   1.000         -  Same hour yesterday
timesfm-univariate       12.08   15.79   0.678      0.80  TimesFM on the PM2.5 history alone
timesfm-past-only        12.17   15.82   0.683      0.79  Plus measured NO2 and CO up to the origin, and no further
timesfm-past-future      10.14   13.02   0.569      0.81  Plus tomorrow's weather, measured rather than forecast
timesfm-both             10.28   13.16   0.577      0.81  Past pollutants and future weather together
leaky-control             6.39    8.53   0.359      0.81  CHEATS *

MASE is MAE relative to seasonal-naive: below 1.0 beats it.
* leaky-control is given tomorrow's NO2 and CO. Its score is what target leakage looks like, not a result.
{"app_name": "timesfm-pm25-covariates", "path": "/app/tmp/smog_episode.png", "event": "Plotting the worst episode...", "level": "info", "timestamp": "2026-09-10T09:42:04.343074Z"}
{"app_name": "timesfm-pm25-covariates", "path": "/app/tmp/smog_episode.png", "event": "Plotting the worst episode succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.432333Z"}
{"app_name": "timesfm-pm25-covariates", "origins": 90, "event": "Running the checks...", "level": "info", "timestamp": "2026-09-10T09:42:04.432377Z"}
{"app_name": "timesfm-pm25-covariates", "rows": 9504, "event": "Validating the snapshot...", "level": "info", "timestamp": "2026-09-10T09:42:04.432404Z"}
{"app_name": "timesfm-pm25-covariates", "rows": 9504, "event": "Validating the snapshot succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.433537Z"}
{"app_name": "timesfm-pm25-covariates", "passed": 6, "total": 6, "event": "Running the checks succeeded.", "level": "info", "timestamp": "2026-09-10T09:42:04.433693Z"}

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

## What the run leaves behind

Everything the run produces is written to `tmp/` in this directory, on your
machine - it is a bind mount, not a Docker volume, so you can open it with
whatever you normally use:

```
tmp/forecasts.npz     every configuration's point forecasts and quantiles
tmp/smog_episode.png  the worst episode in the window, plotted
```

`forecasts.npz` holds one `<configuration>::points` array of shape
(90 origins, 24 hours) and one `<configuration>::quantiles` of
(90, 24, 9) per configuration, plus the scores as JSON. To pull the numbers
out yourself:

```bash
docker compose run --rm lab python -c "
import numpy as np, json
d = np.load('tmp/forecasts.npz', allow_pickle=False)
print(json.loads(str(d['__scores__']))['timesfm-past-future'])
print(d['timesfm-past-future::points'].shape)
"
```

`tmp/` is gitignored, and `docker compose run --rm lab app report` re-renders
the scoreboard and the plot from a saved `forecasts.npz` without re-running the
forecasts. The TimesFM checkpoint stays in a named Docker volume rather than
`tmp/`, so `docker compose down -v` clears the 1.32 GB download but a plain
`rm -rf tmp` does not.

`tmp/smog_episode.png` plots the worst 24-hour episode in the backtest
window - the one starting 2025-12-15, peaking at 136 ug/m3. It is not
flattering: every configuration badly underestimates that peak, and the
0.1-0.9 uncertainty band misses it for most of the episode. That is included on
purpose. A cherry-picked good day would tell you less about whether to trust
this on your own data than the model's actual worst showing does.

## What the covariates were actually worth

Tomorrow's weather is worth about 16% of MAE: 12.08 down to 10.14, MASE 0.678
down to 0.569. That is the single biggest honest gain in the table.

One caveat on that 16%: the "tomorrow's weather" fed to `timesfm-past-future`
and `timesfm-both` is ERA5 *measured* reanalysis for those exact hours, not a
real 24-hour weather forecast. That is not target leakage - PM2.5 itself is
never leaked to any honest configuration - but it is the best possible case
for weather covariates. A genuine forecast carries error that a measured
value does not, so a deployed system feeding it real forecast weather instead
of the true reanalysis would see a smaller gain than 10.14. Treat 16% as an
upper bound on what TimesFM's covariate support is worth here, not a number a
production system would actually get.

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

Three stages. **fetch** is a separate, already-done step; `app run` (the
container's default command) runs the other two, backtest then report, in
order:

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
   - `timesfm-past-future` - plus tomorrow's weather, from ERA5 measured
     reanalysis rather than a real forecast (see below for what that means
     for the result)
   - `timesfm-both` - past pollutants and future weather together
   - `leaky-control` - the cheat described above, included to show what
     leakage looks like rather than to be a real option

   One detail worth knowing if you read `forecast/model.py`: a 24-hour horizon
   is rounded up internally to TimesFM's 64-step output patch. The
   past-and-future covariate blocks are edge-padded over that difference
   rather than pretending to know 64 hours of weather.
3. **report** - renders the scoreboard, plots the worst episode, and runs six
   hard checks (snapshot integrity, output shapes and finiteness, beating the
   baseline, leakage being visible, calibration, and determinism). Whether the
   *honest* covariate configurations beat the univariate one is reported in
   the scoreboard, deliberately not asserted as a check - that is the question
   the lab is asking, and enforcing an answer to it would make the answer
   worthless.

## File layout

```
src/app/
├── __main__.py         # CLI entrypoint: parses argv, configures logging,
│                       #   maps a failed command to exit code 1
├── config.py           # every tunable constant, in one place
├── errors.py           # LabError and the named subclasses each stage raises
├── logging_setup.py    # JSON logging to stdout, one configuration for the app
├── output.py           # the scoreboard/checks text a person reads
├── commands/
│   ├── run.py          # the default: backtest, then report
│   ├── fetch.py        # rebuilds the snapshot from the live Open-Meteo endpoints
│   ├── backtest.py     # runs every configuration over every origin
│   ├── report.py       # re-renders the scoreboard, plot and checks
│   ├── scoreboard.py   # renders the metrics table
│   └── plot.py         # draws the worst smog episode
├── data/
│   ├── openmeteo.py    # pulls both endpoints into one aligned frame (fetch)
│   └── snapshot.py     # loads and validates the committed snapshot (backtest, report)
├── forecast/
│   ├── windows.py      # rolling origins and the slice of data each may see
│   ├── scaling.py      # puts covariate channels on a common scale
│   ├── model.py        # runs TimesFM 3.0 over the backtest windows
│   └── baseline.py     # the seasonal-naive baseline
├── eval/
│   ├── experiments.py  # the six configurations being compared
│   ├── metrics.py      # scores a forecast against what actually happened
│   ├── results.py      # a configuration's output, as data
│   ├── artifact.py     # persists and reloads a backtest's forecasts
│   └── checks.py       # the six hard checks report runs
└── lib/
    └── arrays.py       # the float32 array alias shared by forecast and eval
```

The domain modules above - the ones with a decision or a calculation in
them - carry a colocated `<name>_test.py`. Six thin wiring files don't:
`config.py` and `lib/arrays.py` hold constants and a single type alias
rather than logic; `logging_setup.py` is a thin wrapper around structlog;
and `commands/run.py`, `commands/fetch.py` and `commands/backtest.py`
orchestrate other, already-tested modules rather than deciding anything
themselves (`backtest.py`'s orchestration is also exercised end to end by
every `docker compose up`). There is also a `conftest.py` at the top of the
tree and another inside `commands/`, both fixtures rather than tests, and
`forecast/model_smoke_test.py`, the one slow test, skipped by default
because it needs the real checkpoint.

This departs from a flat, single-domain layout in two places, each for its
own reason: the forecasting module is `forecast/model.py` rather than
`forecast/forecast.py`, since `from app.forecast import forecast` stutters,
and the run's checks live under `eval/` rather than `data/`, since they
score results instead of loading data.

## Running the tests

```bash
docker compose run --rm lab uv run pytest -v -m "not slow"
```

## Refreshing the data

```bash
docker compose run --rm lab app fetch
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
