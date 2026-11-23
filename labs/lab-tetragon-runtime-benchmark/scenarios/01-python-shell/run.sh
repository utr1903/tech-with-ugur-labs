#!/bin/sh
# A Python process starts a shell, as a web-app RCE or a malicious package would.
mkdir -p /tmp/bench || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
python3 -c "import subprocess; subprocess.run(['sh', '-c', 'echo x > /tmp/bench/01.done'])"
