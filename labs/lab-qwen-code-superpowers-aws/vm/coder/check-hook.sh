#!/usr/bin/env bash
# Build-time proof that the Superpowers extension is the pinned commit and
# that its session-start hook prints the format Qwen Code reads.
set -euo pipefail

expected_commit="8ca22dba9a94f28898bbce59f2537ff4d87c747d"
actual_commit="$(git -C /opt/superpowers rev-parse HEAD)"
[ "$actual_commit" = "$expected_commit" ] || { echo "Superpowers is $actual_commit, expected $expected_commit" >&2; exit 1; }

meta="$QWEN_HOME/extensions/superpowers/.qwen-extension-install.json"
node -e '
const meta = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (meta.type !== "local") { console.error("unexpected install type", meta.type); process.exit(1); }
' "$meta"

# Qwen substitutes ${CLAUDE_PLUGIN_ROOT} in the hook command but does not
# export it; the image exports it so the hook prints the nested format.
output="$(bash "$CLAUDE_PLUGIN_ROOT/hooks/run-hook.cmd" session-start)"
node -e '
const out = JSON.parse(process.argv[1]);
const context = out?.hookSpecificOutput?.additionalContext;
if (typeof context !== "string" || !context.includes("superpowers")) {
  console.error("hook output is not in the format Qwen Code reads:", Object.keys(out));
  process.exit(1);
}
' "$output"
echo "Superpowers $expected_commit installed; session-start hook output is readable by Qwen Code."
