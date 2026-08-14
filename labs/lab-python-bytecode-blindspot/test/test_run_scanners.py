import run_scanners


def test_run_scanners_prints_both_verdicts(capsys):
    rc = run_scanners.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "Source-only scanner" in out
    assert "Bytecode-aware scanner" in out
    # source says clean, bytecode says suspicious
    source_block, bytecode_block = out.split("Bytecode-aware scanner")
    assert "CLEAN" in source_block
    assert "SUSPICIOUS" in bytecode_block
    assert "/tmp/leak.txt" in bytecode_block
