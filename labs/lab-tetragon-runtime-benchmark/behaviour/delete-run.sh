#!/bin/sh
# Delete precious.txt and report what rm returned and whether the file is left.
mkdir -p /tmp/bench
echo "lab data" > /tmp/bench/precious.txt
echo "BENCH_ACTION $(date +%s%3N)"
rm /tmp/bench/precious.txt
echo "RM_RC=$?"
if [ -e /tmp/bench/precious.txt ]; then echo "FILE=present"; else echo "FILE=gone"; fi
