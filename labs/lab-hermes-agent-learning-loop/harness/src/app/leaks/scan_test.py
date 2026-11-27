from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.errors import LeakError
from app.leaks.scan import LeakHit, scan, secrets_from_adc

REFRESH = "1//0gRefreshTokenValueForTests"
KEY = "k" * 20


def _adc(tmp_path: Path, **fields: str) -> Path:
    path = tmp_path / "adc.json"
    path.write_text(json.dumps(fields))
    return path


def test_secrets_from_adc_picks_long_secret_values(tmp_path: Path) -> None:
    adc = _adc(tmp_path, refresh_token=REFRESH, client_secret="short", type="x" * 30)
    assert secrets_from_adc(adc) == (REFRESH,)


def test_private_key_body_lines_are_separate_secrets(tmp_path: Path) -> None:
    line = "A" * 64
    key = f"{line}\nshort\n{line[:-1]}B\n"
    secrets = secrets_from_adc(_adc(tmp_path, private_key=key))
    assert key in secrets and line in secrets and "short" not in secrets


def test_missing_adc_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(LeakError):
        secrets_from_adc(tmp_path / "nope.json")


def test_detects_refresh_token_value(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "x.txt").write_text(f"log {REFRESH} end")
    assert scan(tmp_path, [REFRESH]) == [LeakHit(Path("a/x.txt"), "adc-secret")]


def test_detects_access_token_pattern(tmp_path: Path) -> None:
    (tmp_path / "t.json").write_text('{"t": "ya29.' + "a1_-" * 8 + '"}')
    assert scan(tmp_path, []) == [LeakHit(Path("t.json"), "access-token")]


def test_detects_api_server_key(tmp_path: Path) -> None:
    (tmp_path / "t.txt").write_text(f"Bearer {KEY}")
    assert scan(tmp_path, [], api_key=KEY) == [LeakHit(Path("t.txt"), "api-server-key")]


def test_clean_tree(tmp_path: Path) -> None:
    (tmp_path / "t.txt").write_text("nothing here, ya29.short")
    assert scan(tmp_path, [REFRESH], api_key=KEY) == []


def test_symlinks_and_self_report_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "real.txt").write_text("clean")
    (tmp_path / "link.txt").symlink_to(tmp_path / "real.txt")
    (tmp_path / "leak-check.txt").write_text(REFRESH)
    assert scan(tmp_path, [REFRESH]) == []


def test_oversized_file_is_an_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.leaks.scan.MAX_BYTES", 5)
    (tmp_path / "big.bin").write_text("0123456789")
    with pytest.raises(LeakError, match="big.bin"):
        scan(tmp_path, [])


def test_missing_root_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(LeakError, match="absent"):
        scan(tmp_path / "absent", [REFRESH])


def test_adc_without_collectable_secrets_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(LeakError):
        secrets_from_adc(_adc(tmp_path))
    with pytest.raises(LeakError):
        secrets_from_adc(_adc(tmp_path, refresh_token="short", type="x" * 30))


def test_unreadable_file_is_an_error_naming_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "locked.txt").write_text("x")

    def deny(_self: Path) -> bytes:
        raise PermissionError("denied")

    monkeypatch.setattr(Path, "read_bytes", deny)
    with pytest.raises(LeakError, match="locked.txt"):
        scan(tmp_path, [])


def test_detects_project_id(tmp_path: Path) -> None:
    (tmp_path / "run.json").write_text('{"url": "projects/my-gcp-proj-42/x"}')
    hits = scan(tmp_path, (), project_id="my-gcp-proj-42")
    assert hits == [LeakHit(Path("run.json"), "project-id")]
    assert scan(tmp_path, (), project_id="") == []
