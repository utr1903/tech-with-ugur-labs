from __future__ import annotations

from pathlib import Path

import pytest

from app.config import load_settings
from app.errors import ConfigError


def test_defaults_match_the_documented_limits() -> None:
    settings = load_settings({})
    assert settings.port == 8000
    assert settings.host == "0.0.0.0"
    assert settings.work_root == Path("/work")
    assert settings.execution_timeout_seconds == 30.0
    assert settings.max_code_bytes == 65536
    assert settings.max_output_bytes == 65536
    assert settings.max_result_bytes == 65536
    assert settings.max_concurrent_executions == 20


def test_environment_overrides_defaults() -> None:
    settings = load_settings(
        {
            "EXECUTION_TIMEOUT_SECONDS": "1.5",
            "MAX_CONCURRENT_EXECUTIONS": "2",
            "WORK_ROOT": "/tmp/x",
        }
    )
    assert settings.execution_timeout_seconds == 1.5
    assert settings.max_concurrent_executions == 2
    assert settings.work_root == Path("/tmp/x")


@pytest.mark.parametrize(
    ("name", "value"),
    [("PORT", "abc"), ("MAX_CODE_BYTES", "0"), ("EXECUTION_TIMEOUT_SECONDS", "-1")],
)
def test_invalid_values_raise_config_error(name: str, value: str) -> None:
    with pytest.raises(ConfigError, match=name):
        load_settings({name: value})
