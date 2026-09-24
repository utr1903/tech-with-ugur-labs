"""Behavior tests for create-only Cloud Storage writes."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.errors import StorageError
from app.logging_setup import configure_logging
from app.storage import GcsNumberStore


@dataclass(frozen=True)
class Upload:
    """One upload observed by the fake blob."""

    text: str
    content_type: str
    generation_match: int


class FakeBlob:
    """Records upload arguments at the Google client boundary."""

    def __init__(self, *, failure: Exception | None = None) -> None:
        self.failure = failure
        self.uploads: list[Upload] = []

    def upload_from_string(
        self,
        data: str,
        *,
        content_type: str,
        if_generation_match: int,
    ) -> None:
        self.uploads.append(
            Upload(
                text=data,
                content_type=content_type,
                generation_match=if_generation_match,
            )
        )
        if self.failure is not None:
            raise self.failure


class FakeBucket:
    """Returns one controlled blob and records its requested name."""

    def __init__(self, blob: FakeBlob) -> None:
        self.requested_names: list[str] = []
        self.fake_blob = blob

    def blob(self, blob_name: str) -> FakeBlob:
        self.requested_names.append(blob_name)
        return self.fake_blob


def test_uploads_plain_text_with_a_create_only_precondition() -> None:
    blob = FakeBlob()
    bucket = FakeBucket(blob)
    store = GcsNumberStore(
        bucket=bucket,
        log=configure_logging(app_name="number-processor-test"),
    )

    store.write(object_name="result.txt", text="101")

    assert bucket.requested_names == ["result.txt"]
    assert blob.uploads == [
        Upload(text="101", content_type="text/plain", generation_match=0)
    ]


def test_wraps_upload_failures_as_storage_errors() -> None:
    failure = OSError("connection reset")
    store = GcsNumberStore(
        bucket=FakeBucket(FakeBlob(failure=failure)),
        log=configure_logging(app_name="number-processor-test"),
    )

    with pytest.raises(StorageError) as captured:
        store.write(object_name="result.txt", text="101")

    assert captured.value.__cause__ is failure
