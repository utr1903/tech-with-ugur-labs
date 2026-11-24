#!/bin/sh
# Ordinary log rotation: drop the oldest file, shift the rest, start fresh.
# Only the rotated copies (.log.N) are removed, never a live .log file.
cd /var/log/app || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
rm -f app.log.2
mv app.log.1 app.log.2
mv app.log app.log.1
: > app.log
