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


def test_hermes_model_defaults_and_overrides() -> None:
    assert load_settings({"API_SERVER_KEY": KEY}).hermes_model == (
        "google/gemma-4-26b-a4b-it-maas"
    )
    env = {"API_SERVER_KEY": KEY, "HERMES_MODEL": "m/x"}
    assert load_settings(env).hermes_model == "m/x"


def test_project_id_and_adc_switch() -> None:
    settings = load_settings({"API_SERVER_KEY": KEY})
    assert settings.vertex_project_id == "" and settings.leak_check_adc is True
    env = {"API_SERVER_KEY": KEY, "VERTEX_PROJECT_ID": "p-1", "LEAK_CHECK_ADC": "off"}
    settings = load_settings(env)
    assert settings.vertex_project_id == "p-1" and settings.leak_check_adc is False
    assert load_settings({**env, "LEAK_CHECK_ADC": "on"}).leak_check_adc is True


def test_bad_adc_switch_is_a_config_error() -> None:
    with pytest.raises(ConfigError, match="LEAK_CHECK_ADC"):
        load_settings({"API_SERVER_KEY": KEY, "LEAK_CHECK_ADC": "maybe"})
