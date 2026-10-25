# Repositório-template para vsx + Codespaces

Este repositório deve ser usado como **template** para criar um Codespace por aluno.

## O que já vem pronto

- `.devcontainer/` com Dockerfile, `devcontainer.json`, `setup.sh` e `start.sh`
- `@opencode/cli` pré-instalado globalmente
- Ponte do vsx sobe automaticamente na porta `4173` (escutando em `0.0.0.0`)
- URL pública do Codespace detectada automaticamente
- Token da ponte gerado e exibido nos logs

## Como publicar como template

1. Copie este repositório (ou o conteúdo atual do vsx com `.devcontainer/`) para um repositório separado, ex.: `vsx-codespace-template`.
2. No GitHub, vá em **Settings → Template repository** e marque como template.
3. Compartilhe o link do template com os alunos: `https://github.com/<org>/<repo>/generate` ou **Use this template → Open in a new codespace**.

## Instruções para os alunos

Veja [GUIA_ALUNO_CODESPACES.md](../docs/GUIA_ALUNO_CODESPACES.md).

## Observações

- Cada aluno usa seu próprio Codespace (isolado). Não há backend central compartilhado.
- A autenticação do provedor do OpenCode é feita **uma única vez** por aluno (`opencode auth login`) ou via *Codespaces Secrets*.
- O aluno conecta o [vsx no GitHub Pages](https://x3x31.github.io/vsx/) ao seu Codespace pelo modal "Conectar workspace no Codespaces".
- Ao finalizar, pare ou apague o Codespace para economizar cota.
