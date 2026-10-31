#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PORT="${EDUTERMINAL_PORT:-8765}"

if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "offline"
  exit 1
fi

echo "online"
curl -fsS "http://127.0.0.1:$PORT/api/eduterminal/pairing/current" 2>/dev/null || true
echo
