from __future__ import annotations

import gc
import weakref
from types import SimpleNamespace

import pytest

from app.gemini.client import GeminiSettings, GenaiInteractions


class FakeClient:
    """Stands in for genai.Client: closing it would break `interactions`."""

    def __init__(self, **_: object) -> None:
        self.interactions = SimpleNamespace(get=lambda interaction_id: interaction_id)


def test_adapter_keeps_the_sdk_client_alive(monkeypatch: pytest.MonkeyPatch) -> None:
    # genai.Client closes its HTTP session when it is garbage collected, so
    # the adapter must hold the client itself, not only `client.interactions`.
    created: list[weakref.ref[FakeClient]] = []

    def make_client(**kwargs: object) -> FakeClient:
        fake = FakeClient(**kwargs)
        created.append(weakref.ref(fake))
        return fake

    monkeypatch.setattr("google.genai.Client", make_client)
    settings = GeminiSettings(
        api_key="test-key",
        agent="agent",
        api_version="v1beta",
        poll_seconds=1.0,
        timeout_seconds=60.0,
    )

    adapter = GenaiInteractions(settings)
    gc.collect()

    assert created[0]() is not None
    assert adapter.get("abc") == "abc"
