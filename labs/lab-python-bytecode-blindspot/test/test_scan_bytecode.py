import importlib.util

import build_pyc
import scan_bytecode


def test_shipped_pyc_is_flagged_as_mismatch():
    build_pyc.main()
    result = scan_bytecode.scan_module("friendly/__init__.py")
    assert result.mismatch is True
    assert "open" in result.suspicious
    assert any(s.startswith("path:/tmp") for s in result.suspicious)


def test_regenerating_pyc_from_benign_source_reports_clean(tmp_path):
    py = "friendly/__init__.py"
    benign_pyc = str(tmp_path / "benign.pyc")
    build_pyc.build_pyc(py, py, benign_pyc)  # compile the REAL source
    result = scan_bytecode.scan_module(py, pyc_path=benign_pyc)
    assert result.mismatch is False
    assert result.suspicious == []
