from __future__ import annotations

import pytest

from app.logging_setup import Logger, get_logger


@pytest.fixture
def log() -> Logger:
    return get_logger(app_name="sandbox-test")
