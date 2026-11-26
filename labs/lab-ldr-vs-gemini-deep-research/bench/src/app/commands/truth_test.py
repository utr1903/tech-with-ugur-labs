from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from datetime import date
from pathlib import Path

import pytest

from app.commands import truth
from app.errors import ConfigError, TruthError
from app.logging_setup import Logger, get_logger

_PLACEHOLDER = "Your Name your.email@example.org"


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.mark.parametrize("value", [None, "", "   ", _PLACEHOLDER])
def test_unusable_user_agent_is_config_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, log: Logger, value: str | None
) -> None:
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    if value is None:
        monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    else:
        monkeypatch.setenv("SEC_USER_AGENT", value)

    with pytest.raises(ConfigError):
        truth.run(argparse.Namespace(command="truth", check=False), log=log)


_FIXTURES = Path(__file__).parent.parent / "truth" / "fixtures"


def _offline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_fetch(_client: object, url: str, *, log: Logger) -> Mapping[str, object]:
        log.info("Serving a fixture instead of the network.", url=url)
        name = "kev_sample.json" if "cisa" in url else "companyfacts_msft_trimmed.json"
        loaded: dict[str, object] = json.loads((_FIXTURES / name).read_text())
        return loaded

    monkeypatch.setenv("SEC_USER_AGENT", "lab test agent")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(truth, "fetch_json", fake_fetch)
    monkeypatch.setattr(
        truth, "MSFT_QUARTER_ENDS", (date(2025, 3, 31), date(2025, 6, 30))
    )


def test_write_then_check_matches_and_edit_is_detected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, log: Logger
) -> None:
    _offline(monkeypatch, tmp_path)
    write = argparse.Namespace(command="truth", check=False)
    check = argparse.Namespace(command="truth", check=True)

    truth.run(write, log=log)
    truth.run(check, log=log)

    stored = tmp_path / "truth" / truth.KEV_FILE
    stored.write_text(stored.read_text().replace("Hub", "Other"))
    with pytest.raises(TruthError):
        truth.run(check, log=log)


def test_check_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, log: Logger
) -> None:
    _offline(monkeypatch, tmp_path)

    with pytest.raises(TruthError):
        truth.run(argparse.Namespace(command="truth", check=True), log=log)
    assert not (tmp_path / "truth").exists()
