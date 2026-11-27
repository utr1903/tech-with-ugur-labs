from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.errors import ReportError
from app.fixtures.plan import plan_week
from app.fixtures.runbook import REPORT_SCHEMA_EXAMPLE
from app.report_schema.models import TriageReport, load_report


def test_schema_example_validates() -> None:
    report = TriageReport.model_validate_json(REPORT_SCHEMA_EXAMPLE)

    assert report.week == "week-1"
    assert report.services[0].vulnerable_dependencies[0].package == "pyyaml"


def test_answer_key_is_a_valid_report(tmp_path: Path) -> None:
    path = tmp_path / "answer.json"
    path.write_text(json.dumps(plan_week("week-1").answer().to_report_dict()))

    report = load_report(path)

    assert report.week == "week-1"
    assert report.services


def test_extra_keys_rejected(tmp_path: Path) -> None:
    path = tmp_path / "report.json"
    path.write_text('{"week": "week-1", "services": [], "notes": "hi"}')

    with pytest.raises(ReportError):
        load_report(path)


def test_number_version_rejected(tmp_path: Path) -> None:
    path = tmp_path / "report.json"
    path.write_text(
        '{"week": "week-1", "services": [{"service": "a", "suspicious_ips": [],'
        ' "risky_config": [], "vulnerable_dependencies":'
        ' [{"package": "p", "version": 5.3, "advisory_id": "X"}]}]}'
    )

    with pytest.raises(ReportError):
        load_report(path)


def test_invalid_json_raises_report_error(tmp_path: Path) -> None:
    path = tmp_path / "report.json"
    path.write_text("not json")

    with pytest.raises(ReportError):
        load_report(path)


def test_missing_file_raises_report_error(tmp_path: Path) -> None:
    with pytest.raises(ReportError):
        load_report(tmp_path / "absent.json")
