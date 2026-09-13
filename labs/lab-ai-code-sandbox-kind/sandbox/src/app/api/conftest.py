from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from app.api.app_factory import create_app
from app.capabilities.report import build_capabilities
from app.config import Settings, load_settings
from app.execution.workspace import prepare_runs_root
from app.logging_setup import get_logger


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return replace(
        load_settings({}),
        work_root=tmp_path,
        execution_timeout_seconds=5.0,
        max_concurrent_executions=1,
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    log = get_logger(app_name="sandbox-test")
    app = create_app(
        settings=settings,
        capabilities=build_capabilities(settings, log=log),
        runs_root=prepare_runs_root(settings.work_root, log=log),
        log=log,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://sandbox"
    ) as http:
        yield http
