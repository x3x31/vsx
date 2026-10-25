# Fallback local com Docker (para quem não puder usar GitHub Codespaces)

Este guia é um **fallback** para rodar o vsx localmente com Docker, caso não haja cota/condições para usar GitHub Codespaces.

## Pré-requisitos
- [Docker](https://www.docker.com/) e [Docker Compose](https://docs.docker.com/compose/) instalados
- Conta GitHub com token (ou login pelo vsx)
- Pelo menos uma chave de provedor para o OpenCode (Anthropic, OpenAI, OpenRouter, etc.)

## 1) Clonar o repositório
```bash
git clone https://github.com/x3x31/vsx.git
cd vsx
```

## 2) Configurar variáveis
Crie um arquivo `.env` na raiz:
```env
BRIDGE_SECRET=uma-senha-forte
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://x3x31.github.io
```

## 3) Subir a ponte
```bash
docker compose up --build
```
A ponte ficará disponível em `http://localhost:4173`. O log mostrará a URL e a configuração.

## 4) Conectar pelo vsx
1. Abra o [vsx no GitHub Pages](https://x3x31.github.io/vsx/) ou rode localmente (`npm run dev`).
2. Conecte ao GitHub.
3. Clique em **Usar um workspace no Codespaces** / **Conectar workspace** e informe:
   - URL: `http://localhost:4173`
   - Senha: o valor de `BRIDGE_SECRET`

## 5) Autenticar o OpenCode
Dentro do container (ou terminal):
```bash
docker compose exec vsx-bridge opencode auth login
```
Ou configure as chaves via `.env` como acima.

## Observações
- O container monta o repositório em `/workspace` (pode trabalhar com seus projetos).
- Mantenha a ponte rodando enquanto usa o vsx.
- Para parar: `docker compose down`.
- Este fallback não substitui o fluxo multiusuário isolado por Codespace, mas garante acesso caso Codespaces não esteja disponível.
