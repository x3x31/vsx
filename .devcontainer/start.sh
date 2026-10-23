#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PID_FILE="${TMPDIR:-/tmp}/vsx-codespace.pid"
LOG_FILE="${TMPDIR:-/tmp}/vsx-codespace.log"

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "vsx bridge já está rodando (pid $pid)."
    exit 0
  fi
fi

mkdir -p "$(dirname "$LOG_FILE")"
nohup node scripts/start-codespace.mjs >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

echo "vsx bridge iniciada em segundo plano (pid $!)."
echo "URL e senha: $LOG_FILE"
