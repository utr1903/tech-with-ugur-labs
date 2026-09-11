"""Behavior tests for frozen cross-module contracts."""

from __future__ import annotations

from app.contracts import SolveMetadata


def test_solve_metadata_positional_order_keeps_size_before_version() -> None:
    metadata = SolveMetadata("optimal", True, 1.5, 9.0, 0.01, 7, 101, 202, "10.0.2")

    assert metadata.variable_count == 101
    assert metadata.constraint_count == 202
    assert metadata.scip_version == "10.0.2"
