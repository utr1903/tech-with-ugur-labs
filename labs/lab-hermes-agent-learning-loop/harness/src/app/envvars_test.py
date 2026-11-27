from __future__ import annotations

from pathlib import Path

import pytest

from app.envvars import load_settings
from app.errors import ConfigError

KEY = "k" * 16


def test_load_settings_defaults() -> None:
    settings = load_settings({"API_SERVER_KEY": KEY})

    assert settings.hermes_url == "http://hermes:8642"
    assert settings.api_key == KEY
    assert settings.data_dir == Path("/lab/data")
    assert settings.results_dir == Path("/lab/results")
    assert settings.out_dir == Path("/lab/out")
    assert settings.hermes_home == Path("/hermes-home")
    assert settings.adc_file == Path("/adc/adc.json")


def test_load_settings_overrides() -> None:
    settings = load_settings(
        {"API_SERVER_KEY": KEY, "HERMES_URL": "http://x:1", "DATA_DIR": "/d"}
    )

    assert settings.hermes_url == "http://x:1"
    assert settings.data_dir == Path("/d")


@pytest.mark.parametrize("env", [{}, {"API_SERVER_KEY": "short-key"}])
def test_load_settings_rejects_missing_or_short_key(env: dict[str, str]) -> None:
    with pytest.raises(ConfigError) as caught:
        load_settings(env)

    assert "short-key" not in str(caught.value)
