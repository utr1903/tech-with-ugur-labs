"""Tests for the bench command's argument handling."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.commands import bench
from app.errors import ScenarioError
from app.logging_setup import get_logger


def test_only_matching_no_scenario_raises(tmp_path: Path) -> None:
    with pytest.raises(ScenarioError):
        bench.run(
            root=bench.LAB_ROOT,
            runs=1,
            window_s=1.0,
            profiles=["tuned"],
            results_dir=tmp_path,
            only=["99"],
            log=get_logger(),
        )
