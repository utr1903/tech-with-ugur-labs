#!/bin/sh
# Dump the password hashes (this container's own shadow file).
mkdir -p /tmp/bench
echo "BENCH_ACTION $(date +%s%3N)"
cat /etc/shadow > /tmp/bench/11.out
