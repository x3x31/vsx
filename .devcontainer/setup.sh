#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v opencode >/dev/null 2>&1; then
  echo "Instalando @opencode/cli@2.1.3..."
  sudo npm install --global @opencode/cli@2.1.3
fi

echo "OpenCode: $(opencode --version)"
echo "Node:     $(node --version)"
echo "git:      $(git --version)"
