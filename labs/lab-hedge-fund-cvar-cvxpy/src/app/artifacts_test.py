"""Tests for the files a run leaves in `output/`.

Two of these are about failure rather than content. One writes a good run,
then a broken one, and checks the good files are still there byte for byte
— the ordering guarantee that keeps a half-run off the disk. The other
checks that an infeasible headline still produces the full file list with
no book in it, because a missing file and an empty table say different
things to whoever reads the directory next.
"""

from __future__ import annotations

import csv
import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.artifacts import write_artifacts
from app.artifacts_tables import WEIGHT_COLUMNS
from app.bundle import RunBundle
from app.contracts import DualRow
from app.errors import ArtifactError
from app.logging_setup import Logger

ARTIFACTS = [
    "algorithms.csv",
    "duals.csv",
    "frontier.csv",
    "sectors.csv",
    "solution.json",
    "weights.csv",
]


def _rows(path: Path) -> list[dict[str, str]]:
    """Read one CSV back as a list of dictionaries."""
    with path.open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_every_artifact_is_written(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """One run leaves exactly six files and nothing half-named beside them."""
    write_artifacts(tmp_path, bundle, log=log)
    assert sorted(path.name for path in tmp_path.iterdir()) == ARTIFACTS


def test_a_failed_write_leaves_existing_artifacts_untouched(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """Serialization runs to completion before a single byte is written.

    The broken run carries a dual row labelled with a limit the lab cannot
    say which expression it is written on, which is refused while the
    tables are being built. Nothing has been written at that point, so the
    previous run's files are still the previous run's files.
    """
    write_artifacts(tmp_path, bundle, log=log)
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    broken = replace(
        bundle,
        duals=(
            DualRow(
                label="gross_leverage_max",
                active=True,
                dual_value=1.0,
                finite_difference=None,
                agrees=False,
            ),
        ),
    )

    with pytest.raises(ArtifactError, match="gross_leverage_max"):
        write_artifacts(tmp_path, broken, log=log)

    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


def test_solution_json_records_provenance(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """A number is only reproducible with the input and the build beside it."""
    write_artifacts(tmp_path, bundle, log=log)
    payload = json.loads((tmp_path / "solution.json").read_text(encoding="utf-8"))
    assert payload["market"]["digest"] == bundle.market.digest
    assert payload["market"]["mode"] == bundle.market.mode
    assert payload["scenario_digest"] == bundle.scenario_digest
    assert payload["versions"]["cvxpy"]
    assert payload["versions"]["clarabel"]
    assert payload["versions"]["highs"]
    assert payload["versions"]["numpy"]
    assert payload["versions"]["scipy"]
    assert payload["installed_solvers"]
    assert payload["status"] == bundle.headline.status
    assert payload["verification"]["checks"]


def test_solution_json_writes_floats_raw(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """The console rounds; the artifacts do not, or a reader cannot recheck."""
    write_artifacts(tmp_path, bundle, log=log)
    payload = json.loads((tmp_path / "solution.json").read_text(encoding="utf-8"))
    assert bundle.headline.solution is not None
    assert payload["headline"]["solution"]["weights"] == [
        float(value) for value in bundle.headline.solution.weights
    ]


def test_weights_csv_has_one_row_per_name_with_its_split(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """Thirty names, each with the weights and the legs the solver returned."""
    write_artifacts(tmp_path, bundle, log=log)
    rows = _rows(tmp_path / "weights.csv")
    assert len(rows) == 30
    assert set(rows[0]) == set(WEIGHT_COLUMNS)


def test_the_per_name_column_is_the_expression_the_cap_is_written_on(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """`name_gross_used` is `l_i + s_i`, which is what the model constrains."""
    write_artifacts(tmp_path, bundle, log=log)
    solution = bundle.headline.solution
    assert solution is not None
    for index, row in enumerate(_rows(tmp_path / "weights.csv")):
        assert float(row["name_gross_used"]) == pytest.approx(
            float(solution.long_leg[index] + solution.short_leg[index])
        )
        assert float(row["name_gross_cap"]) == bundle.scenario.limits.name_gross_cap


def test_sectors_csv_keeps_the_book_and_the_model_row_apart(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """`book_gross` is `Msec @ |w|`; `model_gross_row` is `Msec @ (l + s)`."""
    write_artifacts(tmp_path, bundle, log=log)
    solution = bundle.headline.solution
    assert solution is not None
    sector = bundle.scenario.universe.sector_matrix
    book = sector @ np.abs(solution.weights)
    model = sector @ (solution.long_leg + solution.short_leg)
    rows = _rows(tmp_path / "sectors.csv")
    assert len(rows) == 6
    for index, row in enumerate(rows):
        assert float(row["book_gross"]) == pytest.approx(float(book[index]))
        assert float(row["model_gross_row"]) == pytest.approx(float(model[index]))


def test_frontier_csv_records_every_target_including_the_unreachable(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """A target the mandate cannot reach keeps its status and drops its book."""
    write_artifacts(tmp_path, bundle, log=log)
    rows = _rows(tmp_path / "frontier.csv")
    assert len(rows) == len(bundle.frontier)
    for row, point in zip(rows, bundle.frontier, strict=True):
        assert row["cvar_status"] == point.cvar_outcome.status
        if point.cvar_outcome.solution is None:
            assert row["cvar_objective"] == ""
        else:
            assert float(row["cvar_objective"]) == pytest.approx(
                point.cvar_outcome.solution.objective
            )


def test_duals_csv_says_what_each_price_is_a_price_on(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """Every priced row carries the expression its activity was decided on."""
    write_artifacts(tmp_path, bundle, log=log)
    rows = _rows(tmp_path / "duals.csv")
    written = {row["label"]: row["written_on"] for row in rows}
    assert written["gross_leverage"] == "l + s"
    assert written["turnover_budget"] == "t"
    assert written["beta_upper"] == "w"


def test_duals_csv_separates_an_unchecked_row_from_an_unconfirmed_one(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """Both report `agrees` false; the `check` column says which happened."""
    write_artifacts(tmp_path, bundle, log=log)
    verdicts = {
        row["label"]: (row["active"], row["agrees"], row["check"])
        for row in _rows(tmp_path / "duals.csv")
    }
    inactive = [verdict for verdict in verdicts.values() if verdict[0] == "False"]
    assert inactive, "the fixture is expected to leave at least one row inactive"
    for active, agrees, check in inactive:
        assert (active, agrees) == ("False", "False")
        assert check == "not binding, so not checked"


def test_an_infeasible_run_still_writes_every_file_and_no_book(
    tmp_path: Path, infeasible_bundle: RunBundle, log: Logger
) -> None:
    """An unreachable target is a result, so the directory keeps its shape."""
    write_artifacts(tmp_path, infeasible_bundle, log=log)
    assert sorted(path.name for path in tmp_path.iterdir()) == ARTIFACTS
    assert _rows(tmp_path / "weights.csv") == []
    assert _rows(tmp_path / "sectors.csv") == []
    payload = json.loads((tmp_path / "solution.json").read_text(encoding="utf-8"))
    assert payload["status"] == "infeasible"
    assert payload["headline"]["solution"] is None
    assert payload["verification"] is None


def test_the_directory_is_created_if_it_is_missing(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """A first run has no `output/` yet, and that is not a failure."""
    target = tmp_path / "output"
    write_artifacts(target, bundle, log=log)
    assert sorted(path.name for path in target.iterdir()) == ARTIFACTS
