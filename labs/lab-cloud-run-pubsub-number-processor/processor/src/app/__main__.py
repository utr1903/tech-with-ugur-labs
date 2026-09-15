"""Entrypoint: configure dependencies and serve HTTP."""

from __future__ import annotations

import os
import sys
from uuid import uuid4

from google.cloud import storage
from waitress import serve

from app.http import create_processor_app
from app.logging_setup import configure_logging, install_global_error_handlers
from app.storage import GcsNumberStore

APP_NAME = "number-processor"


def main() -> int:
    """Wires the production Google client into the HTTP application."""
    log = configure_logging(app_name=APP_NAME)
    install_global_error_handlers(log)

    project_id = os.environ["GOOGLE_CLOUD_PROJECT"]
    bucket_name = os.environ["BUCKET_NAME"]
    port = int(os.environ.get("PORT", "8080"))

    bucket = storage.Client(project=project_id).bucket(bucket_name)
    store = GcsNumberStore(bucket=bucket, log=log)
    application = create_processor_app(store=store, uuid_factory=uuid4, log=log)
    log.info("Starting HTTP server...", port=port)
    serve(application, host="0.0.0.0", port=port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
