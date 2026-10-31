#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

STATE_DIR="$HOME/.eduterminal"
PID_FILE="$STATE_DIR/connector.pid"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
    echo "[eduterminal] servidor parado (pid $PID)"
  else
    echo "[eduterminal] o processo antigo não estava mais rodando"
  fi
  rm -f "$PID_FILE"
else
  echo "[eduterminal] o servidor não estava rodando"
fi

termux-wake-unlock 2>/dev/null || true
