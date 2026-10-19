# vsx

Editor de repositórios do GitHub no navegador, com terminal **OpenCode** integrado.

O `vsx` é uma aplicação web (HTML + JavaScript + CSS, sem framework) dividida em quatro áreas:

| Área | Função |
| --- | --- |
| **Menu lateral esquerdo** | Lista de repositórios do GitHub (com busca) — só entram repositórios onde você tem permissão de escrita |
| **Painel de arquivos** | Árvore de arquivos do repositório selecionado, além do painel de alterações do Git |
| **Editor** | CodeMirror 6 com realce de sintaxe, múltiplas abas e salvamento com `Ctrl+S` |
| **Terminal (parte inferior)** | Sessão do OpenCode **restrita ao repositório selecionado**, para analisar e modificar os arquivos |

## Como funciona

1. **Conexão com o GitHub** — informe um *Personal Access Token* (escopo `repo`). O token é validado
   via `GET /user` e guardado em `~/.config/vsx/config.json` (permissão `600`). Se `GITHUB_TOKEN`
   estiver definido no ambiente, ele é usado automaticamente.
2. **Espelho local** — ao abrir um repositório, o `vsx` o clona (shallow) em
   `~/.local/share/vsx/workspaces/<dono>/<repositorio>`. É esse espelho que alimenta a árvore de
   arquivos, o editor e o terminal, e é dele que o `git push` é feito.
3. **OpenCode** — o servidor do `vsx` sobe um `opencode serve` dedicado. Cada sessão é criada com
   `location.directory` apontando para o espelho do repositório, então o agente **só enxerga e só
   escreve nos arquivos daquele repositório**. Eventos chegam ao navegador por SSE
   (`/api/stream`): texto, chamadas de ferramentas, uso de tokens e pedidos de permissão.

## Requisitos

- Node.js 20+ (testado no 24)
- `git` no `PATH`
- `opencode` instalado e com um provedor de modelo configurado

## Executando

```sh
npm start            # http://127.0.0.1:4173
```

Variáveis de ambiente:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4173` | Porta do servidor web |
| `HOST` | `127.0.0.1` | Interface de escuta |
| `GITHUB_TOKEN` | — | PAT usado quando nenhum token é digitado na interface |

## Atalhos

| Tecla | Ação |
| --- | --- |
| `Ctrl+S` | Salvar o arquivo aberto |
| `Enter` | Enviar a mensagem no terminal |
| `Shift+Enter` | Nova linha no terminal |
| `Esc` | Interromper a execução do OpenCode / fechar modal |
| `Ctrl+Enter` | Enviar a mensagem no terminal a partir de qualquer lugar do formulário |

## Estrutura

```
server/
  index.js      servidor HTTP, rotas da API e bridge SSE
  github.js     cliente da API REST do GitHub
  workspace.js  clone/pull/push, leitura e escrita de arquivos
  opencode.js   servidor OpenCode dedicado (sessões, eventos, permissões)
  config.js     configuração e caminhos
public/
  index.html    estrutura da interface
  css/app.css   tema escuro
  js/           api, repos, árvore, editor, git, terminal, main
  vendor/       CodeMirror 5 empacotado localmente (funciona offline)
```

## API

| Rota | Descrição |
| --- | --- |
| `POST /api/github/connect` | Conecta e valida um token |
| `GET /api/github/repos` | Repositórios com permissão de escrita |
| `POST /api/workspace/open` | Clona/atualiza o espelho e abre o repositório |
| `GET /api/workspace/file` | Lê um arquivo do espelho |
| `PUT /api/workspace/file` | Salva um arquivo |
| `GET /api/workspace/status` | Estado do Git (alterações, branch) |
| `POST /api/workspace/commit` | Commit + push para o GitHub |
| `GET /api/opencode/session` | Sessão do OpenCode para o repositório atual |
| `POST /api/opencode/prompt` | Envia uma mensagem ao OpenCode |
| `POST /api/opencode/permission` | Responde a um pedido de permissão |
| `GET /api/stream` | SSE com eventos do app e do OpenCode |
