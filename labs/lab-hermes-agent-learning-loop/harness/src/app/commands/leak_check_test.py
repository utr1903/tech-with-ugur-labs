from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.commands.leak_check import run
from app.conftest import settings_for
from app.envvars import Settings
from app.errors import LeakError
from app.logging_setup import get_logger

LOG = get_logger()
REFRESH = "1//0gRefreshTokenValueForTests"


def _settings(tmp_path: Path) -> Settings:
    settings = settings_for(tmp_path)
    settings.results_dir.mkdir()
    settings.out_dir.mkdir()
    settings.adc_file.write_text(json.dumps({"refresh_token": REFRESH}))
    return settings


def test_clean_run_writes_exit_zero(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    run(settings, log=LOG)
    report = (settings.results_dir / "leak-check.txt").read_text()
    assert report == "exit=0\nhits=0\n"


def test_hit_message_has_no_secret(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _settings(tmp_path)
    (settings.out_dir / "notes.txt").write_text(f"oops {REFRESH}")
    with pytest.raises(LeakError) as err:
        run(settings, log=LOG)
    report = (settings.results_dir / "leak-check.txt").read_text()
    assert report == f"exit=1\nhits=1\nadc-secret {settings.out_dir.name}/notes.txt\n"
    assert REFRESH not in str(err.value) + report + capsys.readouterr().out


def _report(settings: Settings) -> str:
    return (settings.results_dir / "leak-check.txt").read_text()


def test_missing_adc_fails_and_marks_report_failed(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    settings.adc_file.unlink()
    with pytest.raises(LeakError):
        run(settings, log=LOG)
    assert _report(settings).startswith("exit=1\nhits=0\nerror=")


def test_stale_clean_report_is_replaced_on_failure(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    run(settings, log=LOG)
    assert _report(settings).startswith("exit=0")
    settings.adc_file.write_text("{}")
    with pytest.raises(LeakError):
        run(settings, log=LOG)
    assert _report(settings).startswith("exit=1")


def test_missing_out_dir_is_an_error(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    settings.out_dir.rmdir()
    with pytest.raises(LeakError):
        run(settings, log=LOG)
    assert _report(settings).startswith("exit=1")


def test_missing_results_dir_is_an_error(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    settings.results_dir.rmdir()
    with pytest.raises(LeakError):
        run(settings, log=LOG)


def test_hit_path_with_newline_is_escaped(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    (settings.out_dir / "a\nb.txt").write_text(REFRESH)
    with pytest.raises(LeakError):
        run(settings, log=LOG)
    assert len(_report(settings).splitlines()) == 3
