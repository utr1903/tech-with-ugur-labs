"""Typed view of the environment variables the harness reads."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from app.errors import ConfigError

MIN_KEY_LENGTH = 16


@dataclass(frozen=True)
class Settings:
    """Everything the commands need from the environment."""

    hermes_url: str
    api_key: str
    data_dir: Path
    results_dir: Path
    out_dir: Path
    hermes_home: Path
    adc_file: Path


def load_settings(env: Mapping[str, str]) -> Settings:
    """Builds Settings from `env`, never echoing the API key in an error."""
    api_key = env.get("API_SERVER_KEY", "")
    if len(api_key) < MIN_KEY_LENGTH:
        raise ConfigError(
            f"API_SERVER_KEY must be set and at least {MIN_KEY_LENGTH} characters"
        )
    return Settings(
        hermes_url=env.get("HERMES_URL", "http://hermes:8642"),
        api_key=api_key,
        data_dir=Path(env.get("DATA_DIR", "/lab/data")),
        results_dir=Path(env.get("RESULTS_DIR", "/lab/results")),
        out_dir=Path(env.get("OUT_DIR", "/lab/out")),
        hermes_home=Path(env.get("HERMES_HOME_RO", "/hermes-home")),
        adc_file=Path(env.get("ADC_FILE_RO", "/adc/adc.json")),
    )
