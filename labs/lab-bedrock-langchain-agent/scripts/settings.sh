# Sourced by check.sh and login.sh. Reads a setting with the same precedence
# as Compose: the environment first, then the lab's .env file. The file is
# read as plain text; nothing in it is ever run or expanded.

SETTINGS_ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"

# Prints the value of the setting named $1: the environment variable when it
# is set and not empty, else the last `$1=value` line in .env, else nothing.
# Like Compose, it drops one pair of surrounding quotes, and after an
# unquoted value it drops a ` #` comment.
setting() {
  local key="$1" line name value found=""
  if [ -n "${!key:-}" ]; then
    printf '%s\n' "${!key}"
    return
  fi
  [ -f "$SETTINGS_ENV_FILE" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in *=*) ;; *) continue ;; esac
    name="${line%%=*}"
    name="${name#"${name%%[![:space:]]*}"}"
    name="${name%"${name##*[![:space:]]}"}"
    [ "$name" = "$key" ] || continue
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    case "$value" in
      \"*) value="${value#\"}" && value="${value%%\"*}" ;;
      \'*) value="${value#\'}" && value="${value%%\'*}" ;;
      *)
        value="${value%%[[:space:]]#*}"
        value="${value%"${value##*[![:space:]]}"}"
        ;;
    esac
    found="$value"
  done <"$SETTINGS_ENV_FILE"
  printf '%s\n' "$found"
}
