#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO_URL="${EDUTERMINAL_REPO:-https://github.com/x3x31/vsx.git}"
REPO_DIR="${EDUTERMINAL_REPO_DIR:-$HOME/vsx}"
CONNECTOR_DIR="$REPO_DIR/EduTerminal/connector"
STATE_DIR="$HOME/.eduterminal"
WORKSPACE_DIR="${EDUTERMINAL_WORKSPACE_DIR:-$HOME/eduterminal-workspace}"

echo "[eduterminal] atualizando pacotes do Termux..."
pkg update -y
pkg install -y nodejs git python nano vim curl

echo "[eduterminal] permitindo comandos vindos do app EduTerminal..."
mkdir -p "$HOME/.termux"
touch "$HOME/.termux/termux.properties"
if ! grep -q '^allow-external-apps=true' "$HOME/.termux/termux.properties"; then
  printf '\nallow-external-apps=true\n' >> "$HOME/.termux/termux.properties"
fi
termux-reload-settings 2>/dev/null || true

if [ -d "$REPO_DIR/.git" ]; then
  echo "[eduterminal] atualizando $REPO_DIR..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "[eduterminal] clonando $REPO_URL..."
  git clone "$REPO_URL" "$REPO_DIR"
fi

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

echo "[eduterminal] instalando dependências do connector..."
cd "$CONNECTOR_DIR"
npm install --omit=optional --no-audit --no-fund

if ! command -v opencode >/dev/null 2>&1 && [ "${EDUTERMINAL_SKIP_OPENCODE:-0}" != "1" ]; then
  echo "[eduterminal] tentando instalar o OpenCode..."
  npm install -g opencode-ai --no-audit --no-fund || {
    echo "[eduterminal] aviso: não foi possível instalar o OpenCode automaticamente."
    echo "[eduterminal] instale depois com: npm install -g opencode-ai"
  }
fi

chmod +x "$REPO_DIR/EduTerminal/bootstrap/"*.sh "$REPO_DIR/EduTerminal/installer/"*.sh 2>/dev/null || true

node --version
echo "[eduterminal] instalado em $REPO_DIR"
echo "[eduterminal] abra o app EduTerminal e toque em Iniciar ambiente."
