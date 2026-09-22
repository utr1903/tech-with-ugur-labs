"""Tests for the orchestration and for the exit codes it feeds.

Every scenario file here is written from the shipped `scenario.yaml`'s own
document, with one section replaced, rather than restated from scratch.
That is the same discipline as `conftest.load_mutated`: editing the
shipped file can never leave these tests exercising a mandate the lab no
longer ships.

The sizes are the suite's, not the lab's — 600 scenarios, four frontier
targets, a two-rung ladder and two study seeds — because what these tests
check is the wiring, not the measurement.
"""

from __future__ import annotations

import json
import runpy
import sys
from collections.abc import Callable, Iterator
from copy import deepcopy
from importlib.metadata import entry_points
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import structlog
import yaml

from app import __main__ as entry_point
from app.commands import run as run_command
from app.commands.run import run
from app.errors import (
    ArtifactError,
    InfeasibleError,
    LabError,
    ScenarioError,
    VerificationError,
)
from app.logging_setup import Logger

Document = dict[str, Any]

# The suite's sample. A multiple of twenty, so `(1 - 0.95) * S` is a whole
# number and the linear program, the `sum_largest` oracle and the
# empirical tail average are exactly equal rather than nearly so.
RUN_SAMPLE = 600

# Two runs of the same seed have to agree to better than this, per weight.
# It is a determinism bound, not a solver tolerance: the same seed feeds
# the same matrix to the same method, so the only difference allowed is
# none at all, and the margin is there for a solver that carries its own
# nondeterminism rather than for the lab.
DETERMINISM_ABS = 1e-8


@pytest.fixture(autouse=True)
def _restore_logging_configuration() -> Iterator[None]:
    """Put structlog back the way it was after a test has configured it.

    `main()` installs the real JSON pipeline, and that pipeline caches a
    bound logger on first use. Left in place it would freeze every later
    test's logger onto this file's configuration, and
    `structlog.testing.capture_logs` — which `model_logging_test.py` uses
    to read the build log — would stop intercepting anything. The failure
    shows up in another file, so it is undone here.
    """
    saved = structlog.get_config()
    yield
    structlog.configure(**saved)


def _write(document: Document, path: Path) -> Path:
    """Dump one mutated scenario document to `path` and return it."""
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return path


def _small(document: Document) -> Document:
    """Shrink every sweep in a scenario document to a size a test affords."""
    small = deepcopy(document)
    small["market"]["scenarios"] = RUN_SAMPLE
    small["market"]["out_of_sample_scenarios"] = RUN_SAMPLE
    small["frontier"] = {
        "points": 4,
        "min_target_monthly": 0.0,
        "max_target_monthly": 0.006,
    }
    small["algorithms"]["scenario_ladder"] = [400, RUN_SAMPLE]
    small["studies"]["seeds"] = 2
    small["studies"]["scenarios"] = RUN_SAMPLE
    return small


@pytest.fixture
def small_scenario_file(document: Document, tmp_path: Path) -> Path:
    """Write the shipped mandate at the suite's sample size."""
    return _write(_small(document), tmp_path / "small.yaml")


@pytest.fixture
def infeasible_file(document: Document, tmp_path: Path) -> Path:
    """Write a mandate asked for a monthly return it cannot possibly earn.

    Ten percent a month out of a book capped at 1.32 of NAV gross is far
    above anything the thirty alphas can reach, so the headline solve
    comes back `infeasible` rather than merely expensive.
    """
    document = _small(document)
    document["headline_target_monthly"] = 0.10
    return _write(document, tmp_path / "infeasible.yaml")


def test_a_full_small_run_writes_verified_artifacts(
    tmp_path: Path, small_scenario_file: Path, log: Logger
) -> None:
    """Every stage runs and every file lands with every check passed."""
    output = tmp_path / "output"
    run(small_scenario_file, output, mode=None, seed=None, log=log)

    payload = json.loads((output / "solution.json").read_text(encoding="utf-8"))
    assert payload["status"] == "optimal"
    assert payload["verification"] is not None
    assert all(entry["passed"] for entry in payload["verification"]["checks"])
    assert {path.name for path in output.iterdir()} == {
        "weights.csv",
        "sectors.csv",
        "frontier.csv",
        "algorithms.csv",
        "duals.csv",
        "solution.json",
        "frontier.png",
        "loss_distribution.png",
        "exposures.png",
    }


def test_the_mode_override_reaches_the_generator(
    tmp_path: Path, small_scenario_file: Path, log: Logger
) -> None:
    """`--mode gaussian` changes the market both matrices are drawn from."""
    output = tmp_path / "output"
    run(small_scenario_file, output, mode="gaussian", seed=None, log=log)

    payload = json.loads((output / "solution.json").read_text(encoding="utf-8"))
    assert payload["market"]["mode"] == "gaussian"
    assert payload["out_of_sample"]["mode"] == "gaussian"


def test_the_seed_override_reaches_the_generator(
    tmp_path: Path, small_scenario_file: Path, log: Logger
) -> None:
    """`--seed` moves the in-sample draw and leaves the ruler where it was."""
    output = tmp_path / "output"
    run(small_scenario_file, output, mode=None, seed=20260930, log=log)

    payload = json.loads((output / "solution.json").read_text(encoding="utf-8"))
    assert payload["market"]["seed"] == 20260930
    assert payload["out_of_sample"]["seed"] != 20260930
    assert payload["market"]["digest"] != payload["out_of_sample"]["digest"]


def test_a_seed_override_that_collides_with_the_ruler_is_refused(
    tmp_path: Path, small_scenario_file: Path, log: Logger
) -> None:
    """Drawing the in-sample matrix from the out-of-sample seed is refused.

    The two would then be the same matrix, and every out-of-sample figure
    in the report would read as a perfect zero gap produced by arithmetic
    rather than by measurement. The validator names the field.
    """
    document = yaml.safe_load(small_scenario_file.read_text(encoding="utf-8"))
    collision = int(document["market"]["out_of_sample_seed"])
    output = tmp_path / "output"

    with pytest.raises(ScenarioError, match="market.out_of_sample_seed"):
        run(small_scenario_file, output, mode=None, seed=collision, log=log)
    assert not output.exists()


def test_an_infeasible_headline_target_raises_without_writing(
    tmp_path: Path, infeasible_file: Path, log: Logger
) -> None:
    """An unreachable headline ends the run, and nothing is written."""
    output = tmp_path / "output"

    with pytest.raises(InfeasibleError, match="infeasible"):
        run(infeasible_file, output, mode=None, seed=None, log=log)
    assert not output.exists()


def test_two_runs_with_the_same_seed_agree_to_a_tight_tolerance(
    tmp_path: Path, small_scenario_file: Path, log: Logger
) -> None:
    """Determinism: the same seed gives the same matrix and the same book."""
    first = tmp_path / "first"
    second = tmp_path / "second"
    run(small_scenario_file, first, mode=None, seed=None, log=log)
    run(small_scenario_file, second, mode=None, seed=None, log=log)

    one = json.loads((first / "solution.json").read_text(encoding="utf-8"))
    two = json.loads((second / "solution.json").read_text(encoding="utf-8"))
    assert one["market"]["digest"] == two["market"]["digest"]
    assert one["scenario_digest"] == two["scenario_digest"]
    assert np.allclose(
        one["headline"]["solution"]["weights"],
        two["headline"]["solution"]["weights"],
        rtol=0.0,
        atol=DETERMINISM_ABS,
    )


def test_a_scenario_file_that_does_not_exist_is_a_scenario_error(
    tmp_path: Path, log: Logger
) -> None:
    """The loader's failure reaches the caller as the error the CLI maps."""
    with pytest.raises(ScenarioError):
        run(
            tmp_path / "absent.yaml", tmp_path / "output", mode=None, seed=None, log=log
        )


def _raiser(err: BaseException) -> Callable[..., None]:
    """Return a stand-in for `run` that fails with `err`."""

    def fail(*_args: object, **_kwargs: object) -> None:
        raise err

    return fail


@pytest.mark.parametrize(
    ("err", "code"),
    [
        (ScenarioError("bad field"), 2),
        (InfeasibleError("unreachable"), 3),
        (VerificationError("check failed"), 4),
        (ArtifactError("disk full"), 1),
        (LabError("something else"), 1),
    ],
)
def test_the_cli_maps_each_domain_failure_to_its_exit_code(
    monkeypatch: pytest.MonkeyPatch, err: LabError, code: int
) -> None:
    """Each named failure gets its own exit code, and the rest share one."""
    monkeypatch.setattr(entry_point, "run", _raiser(err))
    monkeypatch.setattr("sys.argv", ["app"])

    assert entry_point.main() == code


def test_the_cli_returns_zero_when_the_run_succeeds(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A run that returns normally exits 0, and the arguments reach it."""
    seen: dict[str, object] = {}

    def record(scenario_path: Path, output_dir: Path, **keywords: object) -> None:
        seen.update({"scenario": scenario_path, "output": output_dir, **keywords})

    monkeypatch.setattr(entry_point, "run", record)
    monkeypatch.setattr(
        "sys.argv",
        [
            "app",
            "--scenario",
            str(tmp_path / "s.yaml"),
            "--output",
            str(tmp_path / "out"),
            "--mode",
            "gaussian",
            "--seed",
            "7",
        ],
    )

    assert entry_point.main() == 0
    assert seen["scenario"] == tmp_path / "s.yaml"
    assert seen["output"] == tmp_path / "out"
    assert seen["mode"] == "gaussian"
    assert seen["seed"] == 7


def test_the_cli_defaults_to_the_lab_s_own_scenario_and_output_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no arguments the command runs `scenario.yaml` into `output/`."""
    seen: dict[str, object] = {}

    def record(scenario_path: Path, output_dir: Path, **keywords: object) -> None:
        seen.update({"scenario": scenario_path, "output": output_dir, **keywords})

    monkeypatch.setattr(entry_point, "run", record)
    monkeypatch.setattr("sys.argv", ["app"])

    assert entry_point.main() == 0
    assert seen["scenario"] == Path("scenario.yaml")
    assert seen["output"] == Path("output")
    assert seen["mode"] is None
    assert seen["seed"] is None


def test_an_unknown_mode_is_rejected_by_the_parser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`--mode` is a closed choice, so a typo never reaches the generator."""
    monkeypatch.setattr("sys.argv", ["app", "--mode", "lognormal"])

    with pytest.raises(SystemExit) as raised:
        entry_point.main()
    assert raised.value.code == 2


def test_running_the_package_as_a_module_reaches_the_command_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`python -m app` executes, and `[project.scripts]` names a real target.

    `pyproject.toml` has pointed `app = "app.__main__:main"` at this
    module since the lab's first commit, and for most of the lab's life
    that module did not exist — so `uv run app` and `python -m app`, the
    workflow the README documents, both failed at import. This test runs
    the package the way the reader does, through `runpy`, which is what
    `python -m` itself uses, rather than asserting that a name imports.
    """
    target = entry_points(group="console_scripts")["app"]
    assert target.value == "app.__main__:main"
    assert target.load() is entry_point.main
    assert run_command.run is run

    monkeypatch.setattr("sys.argv", ["app", "--help"])
    # `runpy` warns when the module it is about to execute is already in
    # `sys.modules` — which it is here, because this file imports it for
    # the exit-code tests. Dropping the entry runs the module the way a
    # cold `python -m app` does, and is why the entry-point identity is
    # asserted above this line rather than below it.
    monkeypatch.delitem(sys.modules, "app.__main__", raising=False)

    with pytest.raises(SystemExit) as raised:
        runpy.run_module("app", run_name="__main__")
    assert raised.value.code == 0
