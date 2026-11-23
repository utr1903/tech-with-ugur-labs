"""Tests for loading scenario definitions."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.errors import ScenarioError
from app.logging_setup import get_logger
from app.scenarios.load import load_scenarios

VALID = """\
id: "11"
technique: T1003.008
name: Read shadow
tactic: Credential Access
pod: victim
expected:
  tuned: detect
  enforce: block
requires: [override]
signals:
  - kind: kprobe
    policy: cred-files
  - kind: exec
    binary_prefix: /tmp/
"""


def _make(root: Path, name: str, yaml_text: str = VALID) -> Path:
    directory = root / name
    directory.mkdir()
    (directory / "scenario.yaml").write_text(yaml_text)
    for script in ("run.sh", "check.sh", "cleanup.sh"):
        (directory / script).write_text("#!/bin/sh\n")
    return directory


def test_loads_and_sorts(tmp_path: Path) -> None:
    _make(tmp_path, "b-second")
    _make(
        tmp_path,
        "a-first",
        "id: b1\ntechnique: benign\nname: Compile\ntactic: benign\n"
        "pod: victim\nbenign: true\n"
        "namespace: build\nexpected: {tuned: miss, enforce: none}\nsignals: []\n",
    )

    scenarios = load_scenarios(tmp_path, log=get_logger())

    assert [s.directory.name for s in scenarios] == ["a-first", "b-second"]
    first, second = scenarios
    assert first.benign and first.namespace == "build" and first.signals == ()
    assert second.namespace == "victim" and not second.benign
    assert second.technique == "T1003.008" and first.technique == "benign"
    assert second.requires == ("override",)
    assert second.expected_enforce == "block"
    assert second.signals[0].kind == "kprobe"
    assert second.signals[0].policy == "cred-files"
    assert second.signals[1].binary_prefix == "/tmp/"


def test_missing_script_raises(tmp_path: Path) -> None:
    directory = _make(tmp_path, "a")
    (directory / "check.sh").unlink()

    with pytest.raises(ScenarioError, match="check.sh"):
        load_scenarios(tmp_path, log=get_logger())


def test_unknown_signal_kind_raises(tmp_path: Path) -> None:
    _make(tmp_path, "a", VALID.replace("kind: exec", "kind: network"))

    with pytest.raises(ScenarioError, match="network"):
        load_scenarios(tmp_path, log=get_logger())


def test_missing_field_raises(tmp_path: Path) -> None:
    _make(tmp_path, "a", VALID.replace("tactic: Credential Access\n", ""))

    with pytest.raises(ScenarioError, match="tactic"):
        load_scenarios(tmp_path, log=get_logger())


def test_missing_technique_raises(tmp_path: Path) -> None:
    _make(tmp_path, "a", VALID.replace("technique: T1003.008\n", ""))

    with pytest.raises(ScenarioError, match="technique"):
        load_scenarios(tmp_path, log=get_logger())


def test_invalid_expected_value_raises(tmp_path: Path) -> None:
    _make(tmp_path, "a", VALID.replace("tuned: detect", "tuned: maybe"))

    with pytest.raises(ScenarioError, match="maybe"):
        load_scenarios(tmp_path, log=get_logger())


def test_malformed_yaml_raises(tmp_path: Path) -> None:
    _make(tmp_path, "a", "id: [unclosed\n")

    with pytest.raises(ScenarioError, match="scenario.yaml"):
        load_scenarios(tmp_path, log=get_logger())


@pytest.mark.parametrize("field", ["binary_regex", "args_regex"])
def test_invalid_regex_raises(tmp_path: Path, field: str) -> None:
    _make(tmp_path, "a", VALID + f"  - kind: exec\n    {field}: '(unclosed'\n")

    with pytest.raises(ScenarioError, match=field):
        load_scenarios(tmp_path, log=get_logger())


def test_loads_attacker_sink_check(tmp_path: Path) -> None:
    directory = _make(tmp_path, "a", VALID + "check:\n  attacker_sink: 4444\n")
    (directory / "check.sh").unlink()

    (scenario,) = load_scenarios(tmp_path, log=get_logger())

    assert scenario.attacker_sink == 4444


def test_check_script_is_used_by_default(tmp_path: Path) -> None:
    _make(tmp_path, "a")

    (scenario,) = load_scenarios(tmp_path, log=get_logger())

    assert scenario.attacker_sink is None


def test_unknown_attacker_sink_raises(tmp_path: Path) -> None:
    _make(tmp_path, "a", VALID + "check:\n  attacker_sink: 9999\n")

    with pytest.raises(ScenarioError, match="attacker_sink"):
        load_scenarios(tmp_path, log=get_logger())
