#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO_DIR="${EDUTERMINAL_REPO_DIR:-$HOME/vsx}"
CONNECTOR_DIR="$REPO_DIR/EduTerminal/connector"
STATE_DIR="$HOME/.eduterminal"
LOG_FILE="$STATE_DIR/connector.log"
PID_FILE="$STATE_DIR/connector.pid"
PORT="${EDUTERMINAL_PORT:-8765}"
WORKSPACE_DIR="${EDUTERMINAL_WORKSPACE_DIR:-$HOME/eduterminal-workspace}"

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[eduterminal] Node.js não encontrado. Rode o instalador primeiro."
  exit 1
fi

if [ ! -f "$CONNECTOR_DIR/bin/eduterminal.mjs" ]; then
  echo "[eduterminal] connector não encontrado em $CONNECTOR_DIR"
  exit 1
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[eduterminal] já está rodando (pid $(cat "$PID_FILE"))"
else
  cd "$CONNECTOR_DIR"
  EDUTERMINAL_PORT="$PORT" \
    EDUTERMINAL_WORKSPACE_DIR="$WORKSPACE_DIR" \
    nohup node bin/eduterminal.mjs >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "[eduterminal] iniciado (pid $(cat "$PID_FILE"))"
fi

termux-wake-lock 2>/dev/null || true

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "[eduterminal] servidor pronto em http://127.0.0.1:$PORT"
    echo "[eduterminal] VSX local: http://127.0.0.1:$PORT/vsx/"
    exit 0
  fi
  sleep 0.5
done

echo "[eduterminal] o servidor não respondeu. Últimas linhas do log:"
tail -n 40 "$LOG_FILE" 2>/dev/null || true
exit 1
