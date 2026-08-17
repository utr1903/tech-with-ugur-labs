"""Print the side-by-side story from the evidence volume."""

import os

ATTACKER = "/evidence/attacker.log"
PROXY = "/evidence/proxy.log"


def _read(path):
    return open(path).read() if os.path.exists(path) else ""


def main():
    attacker = _read(ATTACKER)
    proxy = _read(PROXY)
    denies = [ln for ln in proxy.splitlines() if ln.startswith("DENY")]
    allows = [ln for ln in proxy.splitlines() if ln.startswith("ALLOW")]

    print("=============== INSTALL-TIME EGRESS SANDBOX ===============\n")

    print("UNSAFE  — pip install on the open network:")
    if "host-install" in attacker:
        print("  install SUCCEEDED, and setup.py phoned home.")
        print("  credentials RECEIVED by the attacker sink:")
        for line in attacker.strip().splitlines():
            if "host-install" in line:
                print("    " + line)
                break
    else:
        print("  (no exfil recorded — did the unsafe run execute?)")

    print("\nSAFE    — same pip install, inside the sandbox:")
    print(f"  proxy ALLOWED the package source: {len(allows)} request(s) to mirror")
    if denies:
        print("  proxy BLOCKED the exfiltration attempt:")
        for line in denies:
            print("    " + line)
        print("  the install still SUCCEEDED; the credential grab was blocked")
        print("  and attributed to host 'attacker'. Nothing reached the sink.")
    else:
        print("  (no DENY recorded — did the safe run execute?)")

    print("\n===========================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
