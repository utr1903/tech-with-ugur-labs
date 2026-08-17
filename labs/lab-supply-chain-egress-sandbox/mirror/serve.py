"""Build the demo sdist from the mounted source, then serve it over HTTP.

Building runs the package's setup.py once. This container has no seeded
credentials in its environment, so the install-time exfil is a no-op here.
"""

import http.server
import os
import shutil
import subprocess
import sys
import tempfile

SRC = "/pkg"      # malicious-pkg source, mounted read-only
DIST = "/dist"    # where the built sdist is served from
PORT = 8000

os.makedirs(DIST, exist_ok=True)

# SRC is mounted read-only, but `setup.py sdist` needs to write an
# egg-info directory alongside setup.py. Build from a writable copy.
build_dir = tempfile.mkdtemp()
shutil.copytree(SRC, build_dir, dirs_exist_ok=True)
subprocess.run(
    [sys.executable, "setup.py", "sdist", "--dist-dir", DIST],
    cwd=build_dir,
    check=True,
)
shutil.rmtree(build_dir)  # the sdist now lives in DIST; drop the build copy
os.chdir(DIST)
print(f"mirror: serving {os.listdir(DIST)} on :{PORT}", flush=True)
http.server.HTTPServer(
    ("0.0.0.0", PORT), http.server.SimpleHTTPRequestHandler
).serve_forever()
