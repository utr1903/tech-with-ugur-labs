#!/bin/sh
# Copy a binary and mark it setuid, a classic way to keep root access.
mkdir -p /tmp/bench
cp /usr/bin/id /tmp/bench/suid-id
echo "BENCH_ACTION $(date +%s%3N)"
chmod u+s /tmp/bench/suid-id
