"""Flask routes for authenticated Pub/Sub push delivery."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from flask import Flask, request

from app.errors import MalformedMessageError, StorageError
from app.logging_setup import Logger
from app.messages import Delivery, number_text, parse_delivery
from app.storage import NumberStore

_THRESHOLD = 100


def _completion_fields(
    delivery: Delivery,
    *,
    outcome: str,
    object_name: str | None = None,
) -> dict[str, object]:
    fields: dict[str, object] = {
        "message_id": delivery.message_id,
        "number": delivery.number,
        "outcome": outcome,
    }
    if object_name is not None:
        fields["object_name"] = object_name
    return fields


def create_processor_app(
    *,
    store: NumberStore,
    uuid_factory: Callable[[], UUID],
    log: Logger,
) -> Flask:
    """Builds the HTTP application around injected storage and UUID seams."""
    app = Flask(__name__)

    @app.get("/healthz")
    def health() -> tuple[dict[str, str], int]:
        return {"status": "ok"}, 200

    @app.post("/")
    def process() -> tuple[str, int]:
        payload: object = request.get_json(silent=True)
        try:
            delivery = parse_delivery(payload)
        except MalformedMessageError as err:
            log.warning("Acknowledging malformed delivery.", reason=str(err))
            return "", 204

        if delivery.number <= _THRESHOLD:
            log.info(
                "processed",
                message="Processing delivery succeeded.",
                **_completion_fields(delivery, outcome="skipped"),
            )
            return "", 204

        object_name = f"{uuid_factory()}.txt"
        try:
            store.write(object_name=object_name, text=number_text(delivery.number))
        except StorageError:
            log.exception(
                "Processing delivery failed.",
                message_id=delivery.message_id,
                number=delivery.number,
                object_name=object_name,
            )
            return "", 503

        log.info(
            "processed",
            message="Processing delivery succeeded.",
            **_completion_fields(
                delivery,
                outcome="stored",
                object_name=object_name,
            ),
        )
        return "", 204

    return app
