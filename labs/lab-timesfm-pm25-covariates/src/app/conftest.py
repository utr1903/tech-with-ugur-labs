"""Shared fixtures for the whole app test suite."""

from __future__ import annotations

import pytest

from app.logging_setup import Logger, get_logger


@pytest.fixture
def log() -> Logger:
    """A bound logger for tests that exercise a boundary-wrapped function.

    Built with `get_logger()`, not `configure_logging()` - modules (and
    tests) never install the global JSON pipeline themselves.
    """
    return get_logger(app_name="test")
