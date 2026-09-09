"""JSON logging to stdout. One configuration for the whole app."""

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
    """Returns a bound logger. The one and only `cast` in this codebase.

    `structlog.get_logger()` and `.bind()` are typed `Any`; every other
    call site — app code and tests alike — goes through here instead
    of casting for itself.
    """
    return cast(Logger, structlog.get_logger().bind(**initial_values))


def configure_logging(*, app_name: str) -> Logger:
    """Installs the JSON pipeline and returns the app's root logger."""
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
    """Makes sure the last thing on stdout is JSON, not a raw traceback.

    The interpreter already exits non-zero on an uncaught exception, so
    these hooks only log.
    """

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
