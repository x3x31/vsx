# vsx

Editor de repositórios do GitHub no navegador, com terminal **OpenCode** integrado.

> Especificação e arquitetura completas (inclusive as restrições do navegador que
> moldaram o desenho e o que está em aberto): **[ESPECIFICACAO.md](ESPECIFICACAO.md)**.

O `vsx` é uma aplicação web (HTML + JavaScript + CSS, sem framework) dividida em quatro áreas:

| Área | Função |
| --- | --- |
| **Menu lateral esquerdo** | Lista de repositórios do GitHub (com busca) — só entram repositórios onde você tem permissão de escrita |
| **Painel de arquivos** | Árvore de arquivos do repositório selecionado, além do painel de alterações do Git |
| **Editor** | CodeMirror com realce de sintaxe, múltiplas abas e salvamento com `Ctrl+S` |
| **Terminal (parte inferior)** | Sessão do OpenCode **restrita ao repositório selecionado**, para analisar e modificar os arquivos |

## Conectando ao GitHub

**1. OAuth (recomendado)** — clique em **Conectar com GitHub**. Abre uma janela com o GitHub;
confirme a autorização com a conta que já estiver conectada na outra aba. Ao aceitar, o vsx volta
autorizado e os repositórios carregam sozinhos. Nada de token para copiar.

O fluxo é o **web flow com PKCE**, o mesmo do Supabase e do VS Code:

1. o vsx abre a página de autorização do GitHub numa janela;
2. você confirma (ou faz login, se não estiver logado);
3. o GitHub redireciona para a **ponte** (`/oauth/callback`), que troca o código por um token;
4. a ponte devolve o vsx pela URL, com o token.

Como o passo 3 é uma **navegação** — e não uma chamada de rede bloqueada por CORS — ele funciona
mesmo com a ponte no `127.0.0.1` e o vsx no GitHub Pages. E como usa **PKCE**, não existe
`client_secret` em lugar nenhum: o navegador gera o *verifier* e a ponte o usa na troca.

Para configurar, crie um OAuth App uma única vez:

1. <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. **Authorization callback URL**: o *endereço de retorno* que o vsx mostra na janela de conexão
   (por exemplo `http://127.0.0.1:4173/oauth/callback`)
3. Copie o **Client ID** e cole na janela de conexão do vsx (fica salvo no navegador)

**2. Token de acesso pessoal** — a segunda opção da janela de conexão aceita um PAT com escopo
`repo`. Funciona sem ponte local, útil quando a máquina que roda a ponte não é a mesma do navegador.

### A ponte é encontrada sozinha

O vsx procura a ponte em vários endereços ao abrir a página e de novo a cada clique em
**Conectar com GitHub**:

| Endereço | Quando funciona |
| --- | --- |
| `http://127.0.0.1:4173` | App aberto na própria máquina |
| `https://4173-app.github.dev` | Codespace, pela URL pública da porta |

O endereço da URL pública é impresso pelo servidor no startup. Se a ponte estiver exposta, ela
exige a senha — o vsx detecta isso e pede a senha, que também é impressa no startup.

Se a ponte não for encontrada, clique em **“ponte: off-line”** e informe o endereço à mão (e a
senha, se houver).

## Onde a aplicação roda

A interface é estática e pode ser aberta em qualquer lugar:

- **GitHub Pages** — <https://x3x31.github.io/vsx/>
- **Ponte local** — <http://127.0.0.1:4173> (`npm start`)

São dois modos de operação, e o vsx troca entre eles sozinho:

| | Modo direto | Modo ponte |
| --- | --- | --- |
| Como é usado | No GitHub Pages, sem servidor | Com `npm start` na máquina |
| Repositórios, arquivos, editor, commit | API do GitHub direto pelo navegador | Espelho local + git |
| Terminal do OpenCode | **Precisa da ponte** | ✅ completo |

No **modo direto** o navegador fala com `api.github.com` usando o seu token (a API do GitHub
permite CORS). Como não existe espelho local, o terminal do OpenCode precisa da ponte: clique em
**“ponte: off-line”**, no topo, e informe o endereço do servidor Node (por exemplo
`http://127.0.0.1:4173` ou a URL de porta pública do Codespace).

No **modo ponte** tudo acontece localmente: o repositório é clonado, o `git push` usa o token do
servidor e o terminal tem acesso ao espelho git.

### Terminal a partir do GitHub Pages

O navegador **bloqueia páginas públicas de alcançarem `127.0.0.1`**, então, para usar o terminal
depois de abrir o app no GitHub Pages, a ponte precisa estar em um endereço público. Em um
Codespace:

```sh
HOST=0.0.0.0 npm start
```

O servidor passa a exigir uma senha (o valor é impresso no terminal) e passa a ouvir na porta
pública do Codespace, no formato `https://<porta>-app.github.dev`. Na interface do vsx, clique em
**“ponte: off-line”** e informe o endereço e a senha.

Quando a ponte escuta fora do loopback, a senha é obrigatória — é o que impede outros processos da
rede de usarem o OpenCode da sua máquina.

## Como funciona

1. **Conexão com o GitHub** — informe um *Personal Access Token* (escopo `repo`). O token é
   validado via `GET /user` e fica no `localStorage` do navegador. Na ponte, também é possível
   usar `GITHUB_TOKEN` do ambiente.
2. **Espelho local** (modo ponte) — ao abrir um repositório, o `vsx` o clona (shallow) em
   `~/.local/share/vsx/workspaces/<dono>/<repositorio>`. É esse espelho que alimenta a árvore de
   arquivos, o editor e o terminal, e é dele que o `git push` é feito.
3. **OpenCode** — a ponte sobe um `opencode serve` dedicado. Cada sessão é criada com
   `location.directory` apontando para o espelho do repositório, então o agente **só enxerga e só
   escreve nos arquivos daquele repositório**. Eventos chegam ao navegador por SSE
   (`/api/stream`): texto, chamadas de ferramentas, uso de tokens e pedidos de permissão.

## Requisitos

- Node.js 20+ (testado no 24) — apenas para a ponte
- `git` no `PATH` — apenas para a ponte
- `opencode` instalado e com um provedor de modelo configurado — apenas para o terminal

## Executando a ponte

```sh
npm start            # http://127.0.0.1:4173
```

Variáveis de ambiente:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4173` | Porta do servidor web |
| `HOST` | `127.0.0.1` | Interface de escuta — use `0.0.0.0` para expor (exige senha) |
| `BRIDGE_SECRET` | gerada a cada início | Senha exigida quando a ponte é exposta |
| `GITHUB_TOKEN` | — | PAT usado quando nenhum token é digitado na interface |
| `GITHUB_OAUTH_CLIENT_ID` | — | Client ID do OAuth App para o fluxo de autorização |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | Opcional: só é preciso se o OAuth App não usar PKCE |
| `CORS_ORIGINS` | origem do GitHub Pages + localhost | Origens autorizadas a chamar a ponte |

## Publicação

O GitHub Pages está configurado para publicar a raiz do branch `main`. O arquivo `.nojekyll` na
raiz faz o GitHub ignorar o Jekyll e servir os arquivos como estão, de modo que
`https://x3x31.github.io/vsx/` entrega o `index.html` da aplicação. Basta enviar um commit para
`main`.

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
index.html      estrutura da interface
css/app.css     tema escuro
js/             api, github, bridge, workspace, repos, árvore, editor, git, terminal, main
vendor/         CodeMirror empacotado localmente (funciona offline)
server/
  index.js      servidor HTTP, rotas da API e bridge SSE
  github.js     cliente da API REST do GitHub
  workspace.js  clone/pull/push, leitura e escrita de arquivos
  opencode.js   servidor OpenCode dedicado (sessões, eventos, permissões)
  config.js     configuração e caminhos
```

## API da ponte

| Rota | Descrição |
| --- | --- |
| `GET /api/bridge/info` | Identifica a ponte (usado para detectar se está no ar) |
| `GET /oauth/callback` | Volta da autorização do GitHub: troca o código por um token e redireciona |
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
