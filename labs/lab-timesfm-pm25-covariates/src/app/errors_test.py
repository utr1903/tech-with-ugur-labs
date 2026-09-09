"""Every domain failure is a LabError, so one except clause catches them all."""

from __future__ import annotations

import pytest

from app.errors import (
    ChecksFailedError,
    ExperimentError,
    FetchError,
    LabError,
    SnapshotError,
    WindowError,
)

SUBCLASSES = [
    FetchError,
    SnapshotError,
    WindowError,
    ExperimentError,
    ChecksFailedError,
]


@pytest.mark.parametrize("error_type", SUBCLASSES)
def test_every_domain_error_is_a_lab_error(error_type: type[LabError]) -> None:
    assert issubclass(error_type, LabError)


def test_lab_error_is_not_a_runtime_error() -> None:
    """RuntimeError was the old base; catching it would over-catch."""
    assert not issubclass(LabError, RuntimeError)
