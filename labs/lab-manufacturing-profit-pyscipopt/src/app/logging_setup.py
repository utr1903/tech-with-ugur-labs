"""JSON logging to stdout, configured once by the application entry point."""

from __future__ import annotations

import logging
import os
import sys
import threading
from types import TracebackType
from typing import cast

import structlog

type Logger = structlog.typing.FilteringBoundLogger

_DEFAULT_LEVEL = "info"


def get_logger(**initial_values: object) -> Logger:
    """Return a typed bound logger."""
    return cast(Logger, structlog.get_logger().bind(**initial_values))


def configure_logging(*, app_name: str) -> Logger:
    """Install the JSON logging pipeline and return the root logger."""
    level = logging.getLevelNamesMapping()[
        os.environ.get("LOG_LEVEL", _DEFAULT_LEVEL).upper()
    ]
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    return get_logger(app_name=app_name)


def install_global_error_handlers(log: Logger) -> None:
    """Log uncaught main-thread and worker-thread exceptions as JSON."""

    def handle(
        exc_type: type[BaseException],
        exc: BaseException,
        tb: TracebackType | None,
    ) -> None:
        log.error("Uncaught exception.", exc_info=(exc_type, exc, tb))

    def handle_thread(args: threading.ExceptHookArgs) -> None:
        if args.exc_value is not None:
            handle(args.exc_type, args.exc_value, args.exc_traceback)

    sys.excepthook = handle
    threading.excepthook = handle_thread
