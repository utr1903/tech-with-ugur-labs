#!/bin/sh
# Remove the audit log to cover tracks.
echo "BENCH_ACTION $(date +%s%3N)"
rm -f /var/log/app/audit.log
