"""Fixed entrypoint: only source input, no configurable policy flags."""

from __future__ import annotations

import os
import sys

from app.errors import LabError
from app.execution.run import run_source
from app.logging_setup import configure_logging, install_global_error_handlers


def main() -> int:
    """Map runner outcome to container exit; orchestration remains authoritative."""
    log = configure_logging(app_name="python-runner")
    install_global_error_handlers(log)
    if len(sys.argv) != 1:
        log.error("Starting runner failed.", reason="arguments forbidden")
        return 2
    try:
        result = run_source(os.environ["PYTHON_SOURCE"], log=log)
    except (LabError, KeyError):
        log.exception("Starting runner failed.")
        return 2
    return (
        124 if result.timed_out else (result.exit_code if result.exit_code >= 0 else 1)
    )


if __name__ == "__main__":
    sys.exit(main())
