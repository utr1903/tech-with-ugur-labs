#!/bin/sh
# Happened if the mode shows the setuid bit (4xxx or 6xxx).
case "$(stat -c %a /tmp/bench/suid-id 2>/dev/null)" in
  4??? | 6???) exit 0 ;;
esac
exit 1
