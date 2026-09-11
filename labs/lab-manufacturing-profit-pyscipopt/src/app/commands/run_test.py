from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.commands.run import run
from app.errors import ArtifactError, LabError, ScenarioError, VerificationError
from app.logging_setup import get_logger
from app.scenario import load_scenario


def test_exact_input_bytes(tmp_path: Path) -> None:
    source = Path(__file__).parents[3] / "scenario.yaml"
    data = source.read_bytes()
    changed = tmp_path / "scenario.yaml"
    changed.write_text("broken: true")
    scenario = load_scenario(changed, input_bytes=data, log=get_logger())
    assert scenario.solver.time_limit_seconds == 120.0
    with pytest.raises(ScenarioError, match="solver"):
        load_scenario(
            changed,
            input_bytes=data.replace(b"relative_gap: 0.01", b"relative_gap: -1"),
            log=get_logger(),
        )


def test_run_real_solve_provenance(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = Path(__file__).parents[3] / "scenario.yaml"
    run(source, tmp_path, time_limit_seconds=2.0, relative_gap=0.1, log=get_logger())
    payload = json.loads((tmp_path / "solution.json").read_text())
    assert (
        payload["source"]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    )
    assert payload["source"]["time_limit_seconds_override"] == 2.0
    assert payload["source"]["relative_gap_override"] == 0.1
    output = capsys.readouterr().out
    assert output.index("Solver status:") < output.index("Annual cash")
    assert "Solver auxiliary objective" in output


def test_cli_exit_codes(tmp_path: Path) -> None:
    source = Path(__file__).parents[3] / "scenario.yaml"
    for args, code in [
        (["--scenario", str(tmp_path / "missing.yaml")], 2),
        (
            [
                "--scenario",
                str(source),
                "--time-limit",
                "0.000000001",
                "--output",
                str(tmp_path),
            ],
            3,
        ),
    ]:
        result = subprocess.run(
            [sys.executable, "-m", "app", *args],
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == code, result.stdout + result.stderr
    assert not (tmp_path / "solution.json").exists()


def test_hash_uses_parsed_snapshot_when_file_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import importlib

    from app.logging_setup import Logger

    command = importlib.import_module("app.commands.run")
    original = (Path(__file__).parents[3] / "scenario.yaml").read_bytes()
    source = tmp_path / "scenario.yaml"
    source.write_bytes(original)

    def read_then_edit(path: Path, *, log: Logger) -> bytes:
        del log
        data = path.read_bytes()
        path.write_text("changed: true")
        return data

    monkeypatch.setattr(command, "read_input", read_then_edit)
    run(
        source,
        tmp_path / "output",
        time_limit_seconds=2.0,
        relative_gap=0.1,
        log=get_logger(),
    )
    payload = json.loads((tmp_path / "output/solution.json").read_text())
    assert payload["source"]["sha256"] == hashlib.sha256(original).hexdigest()
    assert (
        payload["source"]["sha256"] != hashlib.sha256(source.read_bytes()).hexdigest()
    )


@pytest.mark.parametrize(
    ("error_type", "exit_code"), [(VerificationError, 4), (ArtifactError, 1)]
)
def test_entrypoint_maps_domain_errors(
    error_type: type[LabError], exit_code: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.__main__ as entry

    def fail(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise error_type("deliberate failure")

    monkeypatch.setattr(entry, "run", fail)
    monkeypatch.setattr(sys, "argv", ["app"])
    assert entry.main() == exit_code
