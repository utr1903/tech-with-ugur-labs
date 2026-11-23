"""Every deliberate failure is a LabError."""

from __future__ import annotations

import pytest

from app import errors


@pytest.mark.parametrize(
    "error_class",
    [
        errors.ScenarioError,
        errors.MarkerMissingError,
        errors.KubeError,
        errors.PolicyError,
        errors.ExpectationError,
    ],
)
def test_all_errors_are_lab_errors(error_class: type[Exception]) -> None:
    assert issubclass(error_class, errors.LabError)
