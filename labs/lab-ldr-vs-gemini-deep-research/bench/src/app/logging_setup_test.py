from __future__ import annotations

import pytest

from app.logging_setup import configure_logging


def test_exception_logs_do_not_include_local_variables(
    capsys: pytest.CaptureFixture[str],
) -> None:
    log = configure_logging(app_name="test")

    def fail() -> None:
        password = "s3cret-value"
        raise ValueError(f"bad {len(password)}")

    try:
        fail()
    except ValueError:
        log.exception("Failed.")

    out = capsys.readouterr().out
    assert "ValueError" in out
    assert "s3cret-value" not in out
