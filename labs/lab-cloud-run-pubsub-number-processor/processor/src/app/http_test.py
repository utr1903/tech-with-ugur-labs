"""Behavior tests for the Pub/Sub push HTTP boundary."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from uuid import UUID

import pytest
from flask.testing import FlaskClient

from app.errors import StorageError
from app.http import create_processor_app
from app.logging_setup import configure_logging


@dataclass(frozen=True)
class WriteCall:
    """A storage write observed by the in-memory test seam."""

    object_name: str
    text: str


class RecordingStore:
    """Records writes and can simulate a bounded transient failure."""

    def __init__(self, *, failures: int = 0) -> None:
        self.calls: list[WriteCall] = []
        self.failures = failures

    def write(self, *, object_name: str, text: str) -> None:
        self.calls.append(WriteCall(object_name=object_name, text=text))
        if self.failures > 0:
            self.failures -= 1
            raise StorageError("storage unavailable")


def envelope(number: int | float, *, message_id: str = "message-123") -> object:
    """Builds a standard wrapped Pub/Sub push body."""
    data = base64.b64encode(json.dumps({"number": number}).encode()).decode()
    return {"message": {"data": data, "messageId": message_id}}


def client_for(
    store: RecordingStore,
    *,
    uuids: tuple[UUID, ...] = (UUID("00000000-0000-4000-8000-000000000001"),),
) -> FlaskClient:
    """Creates a real Flask client with only cloud I/O replaced."""
    uuid_iterator = iter(uuids)
    app = create_processor_app(
        store=store,
        uuid_factory=lambda: next(uuid_iterator),
        log=configure_logging(app_name="number-processor-test"),
    )
    app.config.update(TESTING=True)
    return app.test_client()


def test_reports_health_without_writing() -> None:
    store = RecordingStore()
    client = client_for(store)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
    assert store.calls == []


def test_acknowledges_malformed_delivery_without_writing() -> None:
    store = RecordingStore()
    client = client_for(store)

    response = client.post("/", data="{", content_type="application/json")

    assert response.status_code == 204
    assert store.calls == []


@pytest.mark.parametrize("number", [100, 99, -1])
def test_acknowledges_numbers_at_or_below_the_threshold_without_writing(
    number: int,
) -> None:
    store = RecordingStore()
    client = client_for(store)

    response = client.post("/", json=envelope(number))

    assert response.status_code == 204
    assert store.calls == []


def test_stores_a_qualifying_number_as_plain_text() -> None:
    store = RecordingStore()
    client = client_for(store)

    response = client.post("/", json=envelope(101))

    assert response.status_code == 204
    assert store.calls == [
        WriteCall(
            object_name="00000000-0000-4000-8000-000000000001.txt",
            text="101",
        )
    ]


def test_uses_a_fresh_uuid_for_each_delivery() -> None:
    store = RecordingStore()
    client = client_for(
        store,
        uuids=(
            UUID("00000000-0000-4000-8000-000000000001"),
            UUID("00000000-0000-4000-8000-000000000002"),
        ),
    )

    first = client.post("/", json=envelope(101))
    second = client.post("/", json=envelope(101))

    assert first.status_code == 204
    assert second.status_code == 204
    assert [call.object_name for call in store.calls] == [
        "00000000-0000-4000-8000-000000000001.txt",
        "00000000-0000-4000-8000-000000000002.txt",
    ]


def test_returns_503_until_a_transient_storage_failure_clears() -> None:
    store = RecordingStore(failures=1)
    client = client_for(
        store,
        uuids=(
            UUID("00000000-0000-4000-8000-000000000001"),
            UUID("00000000-0000-4000-8000-000000000002"),
        ),
    )

    first = client.post("/", json=envelope(101))
    retry = client.post("/", json=envelope(101))

    assert first.status_code == 503
    assert retry.status_code == 204
    assert len(store.calls) == 2


@pytest.mark.parametrize(
    ("number", "outcome", "has_object_name"),
    [(100, "skipped", False), (101, "stored", True)],
)
def test_emits_correlatable_completion_logs(
    number: int,
    outcome: str,
    has_object_name: bool,
    capsys: pytest.CaptureFixture[str],
) -> None:
    store = RecordingStore()
    client = client_for(store)

    response = client.post("/", json=envelope(number))
    records = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    completion = next(
        record for record in records if record.get("event") == "processed"
    )

    assert response.status_code == 204
    assert completion["message_id"] == "message-123"
    assert completion["number"] == number
    assert completion["outcome"] == outcome
    assert ("object_name" in completion) is has_object_name
