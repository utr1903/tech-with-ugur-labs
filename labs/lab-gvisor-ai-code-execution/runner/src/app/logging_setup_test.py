"""Exception records stay JSON and never include attacker source locals."""

from __future__ import annotations

import json

from pytest import CaptureFixture

from app.logging_setup import configure_logging


def test_exception_record_has_structured_traceback_without_locals(
    capsys: CaptureFixture[str],
) -> None:
    log = configure_logging(app_name="test")
    source = "do-not-log-attacker-source"
    try:
        _raise_probe()
    except OSError:
        log.exception("Executing source failed.", source_bytes=len(source))
    record = json.loads(capsys.readouterr().out)
    assert isinstance(record["exception"], list)
    assert "do-not-log-attacker-source" not in json.dumps(record)


def _raise_probe() -> None:
    raise OSError("probe")
