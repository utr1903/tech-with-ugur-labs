from __future__ import annotations

from pathlib import Path

import pytest

from app.commands.report import run
from app.errors import ReportError
from app.logging_setup import get_logger
from app.metrics.factory_test import settings_for, write_matrix


def test_report_writes_metrics_md(tmp_path: Path) -> None:
    settings = settings_for(tmp_path)
    write_matrix(settings.results_dir)
    target = run(settings, log=get_logger())
    assert target == settings.results_dir / "metrics.md"
    assert "| full-cold | 1 |" in target.read_text()


def test_report_without_records_fails(tmp_path: Path) -> None:
    settings = settings_for(tmp_path)
    settings.results_dir.mkdir()
    with pytest.raises(ReportError):
        run(settings, log=get_logger())
