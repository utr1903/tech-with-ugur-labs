"""Run both scanners against `friendly` and print the contrast."""

import scan_bytecode
import scan_source


def main():
    print("== Source-only scanner (AST) ==")
    findings = scan_source.scan_package("friendly")
    if findings:
        for f in findings:
            print(f"  FLAG {f.kind}: {f.detail} ({f.file})")
        print("  VERDICT: SUSPICIOUS")
    else:
        print("  Read every .py in friendly/. Nothing suspicious.")
        print("  VERDICT: CLEAN")

    print()
    print("== Bytecode-aware scanner ==")
    result = scan_bytecode.scan_module("friendly/__init__.py")
    if result.mismatch:
        print(f"  Source/bytecode MISMATCH in {result.module}")
        print(f"  The shipped .pyc actually does: {', '.join(result.suspicious)}")
        print("  VERDICT: SUSPICIOUS")
    else:
        print("  Shipped bytecode matches the source.")
        print("  VERDICT: CLEAN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
