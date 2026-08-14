import textwrap

import scan_source


def test_benign_package_scans_clean():
    assert scan_source.scan_package("friendly") == []


def test_scanner_can_flag_a_dirty_source(tmp_path):
    dirty = tmp_path / "dirty.py"
    dirty.write_text(
        textwrap.dedent(
            """
            import os
            with open("/tmp/x", "w") as f:
                f.write(os.environ["SECRET"])
            """
        )
    )
    findings = scan_source.scan_package(str(tmp_path))
    kinds = {f.kind for f in findings}
    assert "import" in kinds
    assert findings  # the scanner is capable; its blindness is source-vs-bytecode
