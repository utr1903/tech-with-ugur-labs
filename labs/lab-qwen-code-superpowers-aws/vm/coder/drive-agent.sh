#!/usr/bin/env bash
# Runs the whole Superpowers flow unattended. Round 1 hands qwen the task;
# whenever a session ends before the agent reports ALL TASKS COMPLETE, the
# driver resumes the same session with one fixed reply chosen from what the
# workspace already contains, like an owner who always says "yes, go on".
# Every reply is printed as a driver event so the transcript shows it.
# No -e: the driver must read each round's exit code and keep deciding.
set -uo pipefail

: "${MAX_TURNS:?}" "${MAX_WALL_TIME:?}" "${MAX_ROUNDS:?}" "${TODAY:?}"
[ -f /workspace/TASK.md ] || { echo "No /workspace/TASK.md" >&2; exit 2; }
cp -a /opt/qwen-seed/. "$QWEN_HOME"/

to_seconds() {   # 90 | 90s | 45m | 1.5h -> whole seconds
  # The image has no python3 (see Dockerfile); node is always available.
  node -e '
    const v = process.argv[1];
    const m = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(v);
    if (!m) process.exit(1);
    console.log(Math.floor(Number(m[1]) * ({ "": 1, s: 1, m: 60, h: 3600 })[m[2]]));
  ' "$1"
}

budget=$(to_seconds "$MAX_WALL_TIME") || { echo "Bad MAX_WALL_TIME: $MAX_WALL_TIME" >&2; exit 2; }
deadline=$(( $(date +%s) + budget ))
contract="Today's date is $TODAY.
$(cat /opt/coder/contract.md)"
round_log=$(mktemp)
trap 'rm -f "$round_log"' EXIT

emit() { printf '%s\n' "$1"; }
json_str() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

# Completion is decided only by the round's own final `result` line, never
# by grepping the whole transcript for the marker: the agent's own
# assistant text or a write_file tool call can contain the string without
# the run actually being done ("When everything is done I will end with
# ALL TASKS COMPLETE", a todo item, a file whose content happens to include
# it, ...). A round can in principle carry more than one `result` line, so
# take the LAST one; require it to have succeeded (`is_error` false) and
# its `result` text, trimmed, to END with the marker line. No `result`
# line at all (e.g. the turn cap or wall-time firing mid-round) is not
# complete either.
round_is_complete() {
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
    let last = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj;
      try { obj = JSON.parse(trimmed); } catch { continue; }
      if (obj && obj.type === "result") last = obj;
    }
    if (!last || last.is_error !== false || typeof last.result !== "string") {
      process.exit(1);
    }
    process.exit(last.result.trim().endsWith("ALL TASKS COMPLETE") ? 0 : 1);
  ' "$1"
}

stage_reply() {   # picks the next scripted reply from the workspace state
  if ! compgen -G "/workspace/docs/superpowers/specs/*.md" >/dev/null; then
    echo "spec|No human is available. Accept your recommended option for every open question and approach, write the spec now under docs/superpowers/specs/, then continue with the plan."
  elif ! compgen -G "/workspace/docs/superpowers/plans/*.md" >/dev/null; then
    echo "plan|The spec is approved. Write the implementation plan now under docs/superpowers/plans/, then continue."
  elif [ "$implement_sent" = no ]; then
    echo "implement|The plan is approved. Execute it now with superpowers:subagent-driven-development and continue until every task is complete and verified."
  else
    echo "continue|Continue until every task in the plan is complete and verified. When everything is done, end your final message with the line: ALL TASKS COMPLETE"
  fi
}

implement_sent=no
round=1
prompt="$(cat /workspace/TASK.md)"
while :; do
  remaining=$(( deadline - $(date +%s) ))
  if [ "$remaining" -le 0 ]; then
    emit "{\"type\":\"driver\",\"event\":\"finished\",\"reason\":\"budget\",\"rounds\":$((round - 1)),\"exitCode\":55}"
    exit 55
  fi
  resume=()
  [ "$round" -gt 1 ] && resume=(--continue)
  qwen "${resume[@]+"${resume[@]}"}" -p "$prompt" \
    --approval-mode yolo --output-format stream-json --include-partial-messages \
    --max-session-turns "$MAX_TURNS" --max-wall-time "${remaining}s" \
    --append-system-prompt "$contract" | tee "$round_log"
  code=${PIPESTATUS[0]}
  if [ "$code" -ne 0 ]; then
    emit "{\"type\":\"driver\",\"event\":\"finished\",\"reason\":\"agent-exit\",\"rounds\":$round,\"exitCode\":$code}"
    exit "$code"
  fi
  if round_is_complete "$round_log"; then
    emit "{\"type\":\"driver\",\"event\":\"finished\",\"reason\":\"complete\",\"rounds\":$round,\"exitCode\":0}"
    exit 0
  fi
  if [ "$round" -ge "$MAX_ROUNDS" ]; then
    emit "{\"type\":\"driver\",\"event\":\"finished\",\"reason\":\"round-cap\",\"rounds\":$round,\"exitCode\":56}"
    exit 56
  fi
  # Check the budget again here, before crafting the next reply: a round
  # that used up the last of the wall-time budget must not be followed by
  # a reply event for a round that will never actually run.
  remaining=$(( deadline - $(date +%s) ))
  if [ "$remaining" -le 0 ]; then
    emit "{\"type\":\"driver\",\"event\":\"finished\",\"reason\":\"budget\",\"rounds\":$round,\"exitCode\":55}"
    exit 55
  fi
  round=$(( round + 1 ))
  IFS='|' read -r stage prompt <<<"$(stage_reply)"
  [ "$stage" = implement ] && implement_sent=yes
  emit "{\"type\":\"driver\",\"event\":\"reply\",\"round\":$round,\"stage\":\"$stage\",\"message\":$(json_str "$prompt")}"
done
