from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.errors import ReportError
from app.fixtures.plan import plan_week
from app.logging_setup import get_logger
from app.report_schema.models import TriageReport, load_report
from app.scoring.score import flatten, score_report

_LOG = get_logger()


def _service(
    name: str,
    ips: list[str] | None = None,
    config: list[str] | None = None,
    deps: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "service": name,
        "suspicious_ips": ips or [],
        "risky_config": config or [],
        "vulnerable_dependencies": deps or [],
    }


def _write(path: Path, *services: dict[str, object]) -> Path:
    path.write_text(json.dumps({"week": "week-1", "services": list(services)}))
    return path


def _truth(tmp_path: Path) -> Path:
    return _write(
        tmp_path / "truth.json",
        _service(
            "billing",
            ips=["10.0.0.1", "10.0.0.2"],
            config=["debug"],
            deps=[{"package": "pyyaml", "version": "5.3", "advisory_id": "TWU-1"}],
        ),
    )


def test_perfect_report_f1_1(tmp_path: Path) -> None:
    truth = _truth(tmp_path)

    score = score_report(truth, truth, log=_LOG)

    assert score.f1 == 1.0
    assert not score.missed
    assert not score.extra
    assert not score.format_failure


@pytest.mark.parametrize("week", ["week-1", "week-2"])
def test_real_answer_scored_against_itself(week: str, tmp_path: Path) -> None:
    path = tmp_path / "answer.json"
    path.write_text(json.dumps(plan_week(week).answer().to_report_dict()))

    score = score_report(path, path, log=_LOG)

    assert score.f1 == 1.0
    assert set(score.by_category) == {"ip", "config", "dep"}


def test_partial_and_extra(tmp_path: Path) -> None:
    report = _write(
        tmp_path / "report.json",
        _service("billing", ips=["10.0.0.1", "10.9.9.9"], config=["debug"]),
    )

    score = score_report(report, _truth(tmp_path), log=_LOG)

    assert score.precision == pytest.approx(2 / 3)
    assert score.recall == pytest.approx(2 / 4)
    assert score.f1 == pytest.approx(2 * (2 / 3) * 0.5 / (2 / 3 + 0.5))
    assert score.extra == (("ip", "billing", "10.9.9.9"),)
    assert set(score.missed) == {
        ("ip", "billing", "10.0.0.2"),
        ("dep", "billing", "pyyaml", "TWU-1"),
    }


def test_duplicates_collapse(tmp_path: Path) -> None:
    report = _write(
        tmp_path / "report.json",
        _service("billing", ips=["10.0.0.1", "10.0.0.1"]),
        _service("billing", ips=["10.0.0.1"]),
    )

    findings = flatten(load_report(report))

    assert findings == frozenset({("ip", "billing", "10.0.0.1")})


def test_normalises_case_and_whitespace(tmp_path: Path) -> None:
    report = _write(
        tmp_path / "report.json",
        _service(
            " Billing ",
            ips=[" 10.0.0.1 "],
            config=[" DEBUG"],
            deps=[{"package": " PyYAML ", "version": "9", "advisory_id": "twu-1 "}],
        ),
    )

    assert flatten(load_report(report)) == frozenset(
        {
            ("ip", "billing", "10.0.0.1"),
            ("config", "billing", "debug"),
            ("dep", "billing", "pyyaml", "TWU-1"),
        }
    )


def test_by_category_scores(tmp_path: Path) -> None:
    report = _write(
        tmp_path / "report.json",
        _service("billing", ips=["10.0.0.1", "10.9.9.9"], config=["debug"]),
    )

    score = score_report(report, _truth(tmp_path), log=_LOG)

    ip = score.by_category["ip"]
    assert (ip.truth, ip.found, ip.correct) == (2, 2, 1)
    assert ip.precision == 0.5
    assert ip.recall == 0.5
    assert score.by_category["config"].f1 == 1.0
    dep = score.by_category["dep"]
    assert (dep.truth, dep.found, dep.correct) == (1, 0, 0)
    assert dep.f1 == 0.0


def test_empty_truth_and_empty_report_is_perfect(tmp_path: Path) -> None:
    empty = _write(tmp_path / "empty.json")

    score = score_report(empty, empty, log=_LOG)

    assert score.f1 == 1.0
    assert score.by_category["ip"].precision == 1.0


def test_score_invalid_json_is_format_failure(tmp_path: Path) -> None:
    report = tmp_path / "report.json"
    report.write_text("{oops")
    truth = _truth(tmp_path)

    score = score_report(report, truth, log=_LOG)

    assert score.format_failure
    assert (score.precision, score.recall, score.f1) == (0.0, 0.0, 0.0)
    assert score.missed == tuple(sorted(flatten(load_report(truth))))
    assert score.extra == ()


def test_missing_file_is_format_failure(tmp_path: Path) -> None:
    score = score_report(tmp_path / "absent.json", _truth(tmp_path), log=_LOG)

    assert score.format_failure
    assert score.f1 == 0.0


def test_invalid_answer_key_raises(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text("nope")

    with pytest.raises(ReportError):
        score_report(_truth(tmp_path), bad, log=_LOG)


def test_to_dict_is_json_serialisable(tmp_path: Path) -> None:
    truth = _truth(tmp_path)

    document = score_report(truth, truth, log=_LOG).to_dict()

    assert json.loads(json.dumps(document))["f1"] == 1.0


def test_report_type_is_exported() -> None:
    assert TriageReport.model_config["strict"] is True
