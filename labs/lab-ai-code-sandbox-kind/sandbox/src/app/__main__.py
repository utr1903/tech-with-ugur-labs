"""Entrypoint: wiring only.

python -m app
"""

from __future__ import annotations

import os
import sys

import uvicorn

from app.api.app_factory import create_app
from app.capabilities.report import build_capabilities
from app.config import load_settings
from app.errors import LabError
from app.execution.workspace import prepare_runs_root
from app.logging_setup import configure_logging, install_global_error_handlers

APP_NAME = "code-sandbox"


def main() -> int:
    """Loads settings, checks the image, serves with a single worker."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)
    try:
        settings = load_settings(os.environ)
        runs_root = prepare_runs_root(settings.work_root, log=log)
        capabilities = build_capabilities(settings, log=log)
    except (LabError, OSError):
        log.exception("Starting sandbox failed.")
        return 1
    app = create_app(
        settings=settings, capabilities=capabilities, runs_root=runs_root, log=log
    )
    log.info("Sandbox listening.", host=settings.host, port=settings.port)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=1,
        log_config=None,
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
