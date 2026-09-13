"""Bounded versioned JSON operation records."""

from __future__ import annotations

import sys
import threading
from types import TracebackType
from typing import cast

import structlog

type Logger = structlog.typing.FilteringBoundLogger


def get_logger(**initial_values: object) -> Logger:
    """Centralize the library's untyped logger construction."""
    return cast(Logger, structlog.get_logger().bind(**initial_values))


def configure_logging(*, app_name: str) -> Logger:
    """Configure a fixed info-level JSON envelope; no user settings."""
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.ExceptionRenderer(
                structlog.tracebacks.ExceptionDictTransformer(
                    show_locals=False, max_frames=6
                )
            ),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    return get_logger(app_name=app_name, captureVersion=1, recordType="operation")


def install_global_error_handlers(log: Logger) -> None:
    """Keep unexpected interpreter and thread errors inside the JSON envelope."""

    def handle(
        exc_type: type[BaseException],
        exc: BaseException,
        tb: TracebackType | None,
    ) -> None:
        log.error("Running interpreter failed.", exc_info=(exc_type, exc, tb))

    def handle_thread(args: threading.ExceptHookArgs) -> None:
        if args.exc_value is not None:
            handle(args.exc_type, args.exc_value, args.exc_traceback)

    sys.excepthook = handle
    threading.excepthook = handle_thread
