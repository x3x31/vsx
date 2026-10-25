# vsx
teste

Editor de repositórios do GitHub no navegador, com terminal **OpenCode** integrado.

> Especificação e arquitetura completas (inclusive as restrições do navegador que
> moldaram o desenho e o que está em aberto): **[ESPECIFICACAO.md](ESPECIFICACAO.md)**.

O `vsx` é uma aplicação web (HTML + JavaScript + CSS, sem framework) dividida em três áreas:

| Área | Função |
| --- | --- |
| **Barra lateral (esquerda)** | **Em cima**: a lista de repositórios do GitHub (com busca) — só entram repositórios onde você tem permissão de escrita. **Embaixo**: a árvore de arquivos do repositório selecionado, além do painel de alterações do Git |
| **Editor** | CodeMirror com realce de sintaxe, múltiplas abas e salvamento com `Ctrl+S` (tema Dracula) |
| **Terminal (parte inferior)** | Sessão do OpenCode **restrita ao repositório selecionado**, para analisar e modificar os arquivos |

A barra lateral, a altura da lista de repositórios e a altura do terminal são **redimensionáveis**:
arraste as divisórias (a de baixo da lista de repositórios, a do lado do editor e a do terminal),
use as setas do teclado com a divisória focada, ou dê um duplo clique para voltar ao tamanho padrão.
Os tamanhos ficam guardados no navegador.

Cada área também pode ser **recolhida** e aberta de novo:

| Botão | Efeito |
| --- | --- |
| **▤** (barra superior, à esquerda) | mostra ou esconde a barra lateral |
| **▾** (barra de abas) | recolhe o editor — sobra só a barra de abas |
| **▾** (cabeçalho do terminal) | recolhe o terminal — sobra só o cabeçalho |
| **⤓ Salvar** (barra superior) | salva a edição do arquivo aberto (o mesmo que `Ctrl+S`) |
| **⏻ Sair** (barra superior) | desloga do repositório |

### No celular

Abaixo de 860 px de largura o layout vira uma **coluna**: a barra lateral (repositórios e
arquivos) fica em cima, e o **editor e o terminal descem para baixo dela**. Nada fica preso na
tela — a página inteira rola, com os painéis junto — mas a **barra superior continua grudada no
topo**, com o botão de salvar e o de deslogar sempre à mão. As divisórias somem (não há espaço
para arrastar) e o espaço é ajustado pelos botões de recolher.

## Uso com GitHub Codespaces (multiusuário)

Para uso em turma com **um Codespace por aluno** (isolado, sem backend central), veja:

- [Guia do aluno — vsx com GitHub Codespaces](docs/GUIA_ALUNO_CODESPACES.md)
- [Instruções para o repositório-template](docs/README_TEMPLATE_CODESPACES.md)

**Fallback (sem Codespaces):** [Guia fallback local com Docker](docs/GUIA_FALLBACK_DOCKER.md)

Com o `.devcontainer/` do projeto, o **OpenCode já vem pré-instalado**. O aluno só precisa autenticar o provedor uma única vez (`opencode auth login` ou via *Codespaces Secrets*), abrir o vsx pelo GitHub Pages e conectar ao próprio Codespace.

## Conectando ao GitHub

**OAuth** — clique em **Conectar com GitHub**. Abre uma janela com o GitHub;
confirme a autorização com a conta que já estiver conectada na outra aba. Ao aceitar, o vsx volta
autorizado e os repositórios carregam sozinhos. Nada de token para copiar — e **qualquer pessoa**
conecta a própria conta, sem cadastrar nada: é o mesmo modelo do VS Code.

O fluxo é o **web flow com PKCE**, o mesmo do Supabase e do VS Code:

1. o vsx abre a página de autorização do GitHub numa janela;
2. você confirma (ou faz login, se não estiver logado);
3. o GitHub devolve um `code` **para a própria página do vsx** (é navegação, então funciona
   mesmo com o vsx no GitHub Pages);
4. o **broker** troca esse código por um token e o devolve para o navegador, que passa a
   guardá-lo no `localStorage`.

O passo 4 é a única parte que o navegador não faz sozinho: `github.com/login/**` não envia
cabeçalhos CORS (ESPECIFICACAO.md §2.1). Por isso existe o **broker** — um worker de poucas
linhas ([broker/](broker/worker.js)), stateless, que só troca código por token. Ele não guarda
credencial de ninguém: o token volta para o navegador de quem autorizou, e a ponte o recebe por
requisição (`x-vsx-token`) quando você a usa.

### Publicando o broker (uma vez só)

O vsx já vem com um broker publicado em <https://vsx.x3x31.workers.dev> (constante
`DEFAULT_BROKER_URL`, em `js/broker.js`) — quem só quer usar o vsx no GitHub Pages não precisa
fazer nada. Publicar outro é questão de um minuto (detalhes em
[broker/README.md](broker/README.md)):

```sh
cd broker
npx wrangler login                        # conta gratuita
# edite wrangler.toml e cole o Client ID do OAuth App
npx wrangler deploy
```

O deploy imprime um endereço, por exemplo `https://vsx-broker.seuusuario.workers.dev`. Cole-o
em `js/broker.js` (constante `DEFAULT_BROKER_URL`) e faça o commit — no navegador dá para
apontar para outro endereço com `localStorage.setItem("vsx.broker", url)`.

O OAuth App é **um só e serve para todos os visitantes** — cada visitante apenas autoriza a
própria conta. Crie em <https://github.com/settings/developers> → **New OAuth App** com
**Authorization callback URL** = `https://x3x31.github.io/vsx/` e use o Client ID em
`VSX_CLIENT_ID` do `broker/wrangler.toml`. O `client_secret` (só é preciso se a troca responder
`incorrect_client_credentials`) fica no broker, nunca no navegador.

Sem broker publicado, o vsx continua funcionando com a **ponte local** — que também expõe
`POST /oauth/exchange` com o mesmo contrato e faz o papel de broker quando é acessível do
navegador (`npm run start:public`).

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

O navegador **bloqueia páginas públicas de alcançarem `127.0.0.1`** (política do Chrome), então a
ponte precisa de um endereço que o navegador alcance. O jeito mais simples é o **túnel público**, que
a própria ponte abre:

```sh
npm run start:public
```

O servidor sobe um túnel com o [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(`npm i -g cloudflared`) e imprime o endereço:

```
túnel público: https://xyz.trycloudflare.com
use esse endereço no botão “ponte” do vsx
```

Depois, no vsx aberto no GitHub Pages, clique em **“ponte: off-line”** e informe:

| Campo | Valor |
| --- | --- |
| Endereço da ponte | o endereço do túnel |
| Senha | a senha impressa pelo servidor |

Com a ponte alcançável, o botão **Conectar com GitHub** continua funcionando: quando o broker
não está configurado, é a ponte quem troca o código por token (`POST /oauth/exchange`) e o token
vai para o navegador de quem autorizou.

No OAuth App, o **callback URL** deve ser a URL do próprio vsx
(`https://x3x31.github.io/vsx/`), que o app mostra no campo “endereço de retorno”.

Quando a ponte escuta fora do loopback, a senha é obrigatória — é o que impede outros processos da
rede de usarem o OpenCode da sua máquina.

## Como funciona

1. **Conexão com o GitHub** — OAuth com PKCE (o broker troca o código por token) ou, na
   falta dele, um *Personal Access Token* (escopo `repo`). Em qualquer caso o token é validado
   via `GET /user` e fica no `localStorage` do navegador. Na ponte, também é possível usar
   `GITHUB_TOKEN` do ambiente.
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
| `Setas` (com uma divisória focada) | Redimensionar o painel |

## Estrutura

```
index.html      estrutura da interface
css/app.css     tema Dracula
js/             api, github, bridge, broker, workspace, repos, árvore, editor, ícones,
                layout (divisórias e painéis expansíveis), git, terminal, main
vendor/         CodeMirror empacotado localmente (funciona offline) + fontes Seti e
                codicon (os ícones do VS Code)
broker/
  worker.js     worker stateless que troca o code da autorização por token
  wrangler.toml configuração do deploy (Client ID e origens autorizadas)
server/
  index.js      servidor HTTP, rotas da API e bridge SSE
  github.js     cliente da API REST do GitHub
  oauth.js      fluxo web e de dispositivo do GitHub
  workspace.js  clone/pull/push, leitura e escrita de arquivos
  opencode.js   servidor OpenCode dedicado (sessões, eventos, permissões)
  config.js     configuração e caminhos
test/           testes: broker, ponte, o fluxo completo no navegador e o layout
                responsivo
```

## Testes

```sh
npm test          # broker + ponte (sem dependência externa)
npm run test:e2e  # fluxo completo no navegador (requer: npx playwright install chromium)
```

O teste de ponta a ponta sobe o broker (o worker real), o site em outra origem e um GitHub
simulado, e clica em **Conectar com GitHub**: autorização, troca do código por token e
conexão — exatamente o que acontece no GitHub Pages. O mesmo comando confere o **layout
responsivo**: no celular o editor e o terminal descem para baixo da barra lateral, a barra
superior fica grudada no topo e os três painéis podem ser recolhidos.

## API da ponte

| Rota | Descrição |
| --- | --- |
| `GET /api/bridge/info` | Identifica a ponte (usado para detectar se está no ar) |
| `GET /oauth/callback` | Volta da autorização no modo local: troca o código por um token e redireciona |
| `POST /oauth/exchange` | Troca o código por um token e o devolve para o navegador (modo remoto / broker) |
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
