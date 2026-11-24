#!/bin/sh
# Succeeded if the rotation went through.
cd /var/log/app || exit 1
grep -qx current app.log.1 && grep -qx previous app.log.2 && test -e app.log
