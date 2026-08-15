"""AST scanner for Python source. Flags env access, file writes, and risky
imports. It is thorough — and still blind to anything not in the .py it reads."""

import ast
import os
from dataclasses import dataclass

SUSPICIOUS_CALLS = {"open", "eval", "exec", "compile", "__import__"}
SUSPICIOUS_ATTRS = {"environ", "getenv", "system", "popen", "write", "connect"}
SUSPICIOUS_MODULES = {"os", "subprocess", "socket", "requests", "urllib"}


@dataclass
class Finding:
    file: str
    kind: str
    detail: str


def scan_source_file(path):
    tree = ast.parse(open(path).read(), path)
    findings = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in SUSPICIOUS_CALLS:
                findings.append(Finding(path, "call", node.func.id))
        if isinstance(node, ast.Attribute) and node.attr in SUSPICIOUS_ATTRS:
            findings.append(Finding(path, "attr", node.attr))
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in SUSPICIOUS_MODULES:
                    findings.append(Finding(path, "import", alias.name))
        if isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in SUSPICIOUS_MODULES:
                findings.append(Finding(path, "import", node.module))
    return findings


def scan_package(pkg_dir):
    findings = []
    for name in sorted(os.listdir(pkg_dir)):
        if name.endswith(".py"):
            findings.extend(scan_source_file(os.path.join(pkg_dir, name)))
    return findings
