"""Create-only writes to the processor's Cloud Storage bucket."""

from __future__ import annotations

from typing import Protocol

from app.errors import StorageError
from app.logging_setup import Logger


class NumberStore(Protocol):
    """Storage operation used by the HTTP processor."""

    def write(self, *, object_name: str, text: str) -> None:
        """Writes a number using a newly selected object name."""


class ObjectBlob(Protocol):
    """Subset of the Cloud Storage blob API needed for one upload."""

    def upload_from_string(
        self,
        data: str,
        *,
        content_type: str,
        if_generation_match: int,
    ) -> object: ...


class ObjectBucket(Protocol):
    """Subset of the Cloud Storage bucket API needed by this service."""

    def blob(self, blob_name: str) -> ObjectBlob: ...


class GcsNumberStore:
    """Stores each number in a new, create-only Cloud Storage object."""

    def __init__(self, *, bucket: ObjectBucket, log: Logger) -> None:
        self._bucket = bucket
        self._log = log

    def write(self, *, object_name: str, text: str) -> None:
        """Uploads plain text and refuses to overwrite an existing object."""
        self._log.info("Storing number...", object_name=object_name)
        try:
            blob = self._bucket.blob(object_name)
            blob.upload_from_string(
                text,
                content_type="text/plain",
                if_generation_match=0,
            )
        except Exception as err:
            self._log.exception("Storing number failed.", object_name=object_name)
            raise StorageError(f"failed to create {object_name}") from err
        else:
            self._log.info("Storing number succeeded.", object_name=object_name)
