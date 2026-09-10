"""Every tunable constant for the lab, in one place."""

from __future__ import annotations

import os
from pathlib import Path

# --- Location: Milan, in the Po Valley basin. ---
LATITUDE = 45.4642
LONGITUDE = 9.19

# --- Snapshot extent: 13 months of hourly data. ---
FETCH_START = "2025-08-01"
FETCH_END = "2026-08-31"
EXPECTED_ROWS = 9504

AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive"

# Pollutants. Measured hourly, but NOT knowable in advance.
AIR_QUALITY_VARIABLES = (
    "pm2_5",
    "nitrogen_dioxide",
    "carbon_monoxide",
)

# Weather. The things a forecast genuinely tells you about tomorrow.
WEATHER_VARIABLES = (
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "precipitation",
    "surface_pressure",
    "boundary_layer_height",
)

ALL_VARIABLES = AIR_QUALITY_VARIABLES + WEATHER_VARIABLES
TARGET = "pm2_5"

# --- Backtest geometry. These exact values reproduce a seasonal-naive
# --- MAE of 17.83 ug/m3; changing them changes that number.
BACKTEST_START = "2025-12-01"
BACKTEST_END = "2026-02-28"
EXPECTED_ORIGINS = 90
CONTEXT_HOURS = 512
HORIZON_HOURS = 24
SEASONAL_PERIOD_HOURS = 24

# --- Model. ---
CHECKPOINT = "google/timesfm-3.0-pytorch"
BATCH_SIZE = 8
N_QUANTILES = 9
LOW_QUANTILE_INDEX = 0  # 0.1
HIGH_QUANTILE_INDEX = 8  # 0.9

# --- Reference values measured on this exact window. ---
REFERENCE_SEASONAL_NAIVE_MAE = 17.83
REFERENCE_MAE_TOLERANCE = 0.01
MIN_BAND_COVERAGE = 0.60
MAX_BAND_COVERAGE = 0.95
# One batch's worth of origins: a later determinism check re-runs exactly
# this subset, so it tests bit-identical repeatability, not sensitivity to
# which origins happen to share a batch.
DETERMINISM_ORIGINS = BATCH_SIZE

# --- Paths. Resolved from the environment so the installed package does not
# --- depend on where its source happens to live. Defaults are relative to the
# --- working directory, which is the lab directory locally and /app in the
# --- container.
DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "tmp"))
SNAPSHOT_PATH = DATA_DIR / "milan_air_quality_hourly.csv"
FORECASTS_PATH = OUTPUT_DIR / "forecasts.npz"
EPISODE_PLOT_PATH = OUTPUT_DIR / "smog_episode.png"
