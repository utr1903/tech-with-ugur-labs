from __future__ import annotations

from app.answers.extract import extract_last_json_block


def test_single_block() -> None:
    assert extract_last_json_block('text\n```json\n{"a": 1}\n```\n') == {"a": 1}


def test_two_blocks_returns_second() -> None:
    report = '```json\n{"a": 1}\n```\nfinal\n```json\n{"a": 2}\n```'
    assert extract_last_json_block(report) == {"a": 2}


def test_invalid_last_block_falls_back_to_earlier() -> None:
    report = '```json\n{"a": 1}\n```\n```json\n{oops\n```'
    assert extract_last_json_block(report) == {"a": 1}


def test_uppercase_language_tag_accepted() -> None:
    assert extract_last_json_block('```JSON\n{"a": 3}\n```') == {"a": 3}


def test_no_block_returns_none() -> None:
    assert extract_last_json_block("no blocks here") is None


def test_plain_fence_is_ignored() -> None:
    assert extract_last_json_block('```\n{"a": 1}\n```') is None
