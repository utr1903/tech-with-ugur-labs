# Snapshot provenance

`milan_air_quality_hourly.csv` holds 9,504 hourly observations for Milan
(45.4642 N, 9.19 E) covering 2025-08-01T00:00 through 2026-08-31T23:00 UTC.

| Columns | Source |
|---|---|
| `pm2_5`, `nitrogen_dioxide`, `carbon_monoxide` (ug/m3) | [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), CAMS Europe model |
| `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `precipitation`, `surface_pressure`, `boundary_layer_height` | [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), ERA5 reanalysis |

Both endpoints are keyless and serve archive/reanalysis data, so past dates are
stable — which is why this file is committed rather than fetched on every run.
The backtest is therefore deterministic and works offline.

The snapshot spans 13 months even though the backtest only uses the Dec-Feb
winter window (`BACKTEST_START`/`BACKTEST_END` in `labconfig.py`); the extra
range lets that window be moved, or the summer contrast be examined, without
re-fetching.

Regenerate or re-target it with `docker compose run --rm lab python main.py fetch`.

Data (c) [Open-Meteo](https://open-meteo.com/), licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Air quality data is
produced by the [Copernicus Atmosphere Monitoring Service (CAMS)](https://atmosphere.copernicus.eu/).
