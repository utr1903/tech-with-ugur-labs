from __future__ import annotations

import os
from pathlib import Path

from app.execution.result_file import read_result_file


def test_missing_file_is_no_result_and_no_error(tmp_path: Path) -> None:
    result = read_result_file(tmp_path, limit=100)
    assert (result.value, result.error) == (None, None)


def test_valid_json_is_parsed(tmp_path: Path) -> None:
    (tmp_path / "result.json").write_text('{"x": [3, 2, 5]}')
    assert read_result_file(tmp_path, limit=100).value == {"x": [3, 2, 5]}


def test_invalid_json_is_reported(tmp_path: Path) -> None:
    (tmp_path / "result.json").write_text("{not json")
    result = read_result_file(tmp_path, limit=100)
    assert result.value is None
    assert result.error is not None
    assert "not valid JSON" in result.error
    assert "{not json" not in result.error


def test_non_finite_numbers_are_rejected(tmp_path: Path) -> None:
    (tmp_path / "result.json").write_text('{"x": NaN}')
    assert "not valid JSON" in (read_result_file(tmp_path, limit=100).error or "")


def test_oversized_file_is_reported(tmp_path: Path) -> None:
    (tmp_path / "result.json").write_text('"' + "a" * 200 + '"')
    result = read_result_file(tmp_path, limit=100)
    assert result.value is None
    assert "larger than 100 bytes" in (result.error or "")


def test_symlink_is_not_followed(tmp_path: Path) -> None:
    secret = tmp_path / "secret.json"
    secret.write_text('{"secret": true}')
    (tmp_path / "result.json").symlink_to(secret)
    result = read_result_file(tmp_path, limit=100)
    assert result.value is None
    assert result.error is not None


def test_fifo_does_not_block(tmp_path: Path) -> None:
    os.mkfifo(tmp_path / "result.json")
    result = read_result_file(tmp_path, limit=100)
    assert result.value is None
    assert "regular file" in (result.error or "")
