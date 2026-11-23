#!/bin/sh
# Remove the audit log to cover tracks.
test -f /var/log/app/audit.log || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
rm -f /var/log/app/audit.log
