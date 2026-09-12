#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/bin" "$fixture/evidence"
printf '#!/usr/bin/env bash\nexit 1\n' > "$fixture/bin/docker"
chmod +x "$fixture/bin/docker"
for script in runtime-smoke.sh network-smoke.sh; do
  printf '{"prior":"success"}\n' > "$fixture/evidence/result.json"
  printf 'keep\n' > "$fixture/evidence/unrelated.txt"
  if PATH="$fixture/bin:$PATH" bash "$script_dir/$script" "$fixture/evidence"; then exit 1; fi
  test ! -e "$fixture/evidence/result.json"
  test "$(cat "$fixture/evidence/unrelated.txt")" = keep
done
printf 'PASS: failed entry invalidates only owned stale result\n'
