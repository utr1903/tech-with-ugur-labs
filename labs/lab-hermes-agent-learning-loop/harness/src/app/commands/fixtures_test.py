from __future__ import annotations

from pathlib import Path

import pytest

from app.commands import fixtures
from app.envvars import load_settings
from app.errors import FixtureError
from app.logging_setup import get_logger


def test_generate_then_check_passes(tmp_path: Path) -> None:
    settings = load_settings({"API_SERVER_KEY": "k" * 16, "DATA_DIR": str(tmp_path)})

    fixtures.run(settings, check=False, log=get_logger())
    fixtures.run(settings, check=True, log=get_logger())


def test_check_fails_when_a_file_differs(tmp_path: Path) -> None:
    settings = load_settings({"API_SERVER_KEY": "k" * 16, "DATA_DIR": str(tmp_path)})
    fixtures.run(settings, check=False, log=get_logger())
    (tmp_path / "answers/week-1.json").write_text("{}\n")

    with pytest.raises(FixtureError):
        fixtures.run(settings, check=True, log=get_logger())
