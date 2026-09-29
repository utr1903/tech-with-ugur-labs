#!/usr/bin/env bash
# Build-time proof that the Superpowers extension is the pinned commit,
# installed from the local clone, and wired the way Qwen Code actually
# reads it: through the extension's context file, not its session-start
# hook (see the Dockerfile for why the hook is inert here).
set -euo pipefail

expected_commit="8ca22dba9a94f28898bbce59f2537ff4d87c747d"
actual_commit="$(git -C /opt/superpowers rev-parse HEAD)"
[ "$actual_commit" = "$expected_commit" ] || { echo "Superpowers is $actual_commit, expected $expected_commit" >&2; exit 1; }

extension_dir="$QWEN_HOME/extensions/superpowers"

meta="$extension_dir/.qwen-extension-install.json"
node -e '
const meta = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (meta.type !== "local") { console.error("unexpected install type", meta.type); process.exit(1); }
' "$meta"

# Qwen Code loads the extension's context file at every session start.
# Assert it is still named GEMINI.md and that GEMINI.md still imports the
# using-superpowers skill, since that is now the only path the bootstrap
# reaches the model through.
manifest="$extension_dir/qwen-extension.json"
node -e '
const meta = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (meta.contextFileName !== "GEMINI.md") {
  console.error("extension context file is not GEMINI.md:", meta.contextFileName);
  process.exit(1);
}
' "$manifest"

grep -qF "skills/using-superpowers/SKILL.md" "$extension_dir/GEMINI.md" \
  || { echo "GEMINI.md does not import skills/using-superpowers/SKILL.md" >&2; exit 1; }

echo "Superpowers $expected_commit installed from the local clone; GEMINI.md imports the using-superpowers skill."
