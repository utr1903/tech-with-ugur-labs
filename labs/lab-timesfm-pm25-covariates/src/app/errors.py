"""Every way this lab can fail on purpose.

One base class so __main__ has exactly one thing to catch, and named
subclasses so a caught error says which boundary produced it.
"""

from __future__ import annotations


class LabError(Exception):
    """Base for every failure this lab raises deliberately."""


class FetchError(LabError):
    """The upstream endpoints disagreed or returned nothing usable."""


class SnapshotError(LabError):
    """The snapshot is not the dataset the backtest expects."""


class WindowError(LabError):
    """A forecast origin does not fit in the snapshot."""


class ExperimentError(LabError):
    """No configuration by that name."""


class ArtifactError(LabError):
    """The saved backtest is missing, unreadable, or not what save_artifact wrote."""


class ChecksFailedError(LabError):
    """At least one hard check did not pass, so the run means nothing."""
