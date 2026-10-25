# VSX 2
# vsx — especificação e arquitetura

> Documento de referência e de continuidade. Descreve o que o vsx é, como ele é
> estruturado, as restrições do navegador que moldaram o desenho, e o que ainda
> está em aberto.
>
> Última atualização: depois da **parte 3 do §14.8** (provedor
> Codespaces no frontend) e do refinamento **parte 3.1** — o
> fluxo OAuth web com PKCE, o **broker** stateless (o vsx no Pages conecta
> qualquer usuário com um clique, sem ponte), os testes do repositório
> (`npm test`, `npm run test:e2e`), o tema **Dracula** com os ícones do VS Code
> na árvore, o modo HTML no editor, a **barra lateral com repositórios e
> arquivos empilhados**, com divisórias para aumentar a área do editor (§4.6),
> e o **layout responsivo**: no celular o editor e o terminal descem para baixo
> da barra lateral, a barra superior fica grudada no topo e qualquer painel
> pode ser recolhido (§4.7). Esta revisão acrescenta a decisão de arquitetura
> para o uso **multiusuário**: GitHub **Codespaces** como workspace de cada
> aluno, mantendo o Pages como interface única e sem backend central de
> computação. O plano de implementação está em §14; o glossário passou para
> §15.
>
> As **partes 1, 2, 3 e 3.1** do §14.8 (empacotamento, ponte adaptada ao
> Codespaces, provedor no frontend e refinamento) estão concluídas. A
> ponte detecta as variáveis do Codespaces, escuta em `0.0.0.0`, anuncia a
> URL pública no formato `https://<CODESPACE_NAME>-<porta>.<domínio>`, exige token em todas as
> rotas de API e restringe o CORS ao Pages e à própria origem pública. O
> frontend conecta-se a esse workspace pelo Pages, guarda a URL/senha no
> `localStorage` e reconhece workspace parado/expirado ou token recusado.

---

## 1. O que é

O **vsx** é uma aplicação web (HTML + CSS + JavaScript puro, sem framework e sem
build) que funciona como editor de repositórios do GitHub com um terminal do
**OpenCode** acoplado.

Ela funciona em três arranjos:

| Onde | Como | URL |
| --- | --- | --- |
| **Local (modelo VS Code)** | `npm start` sobe o servidor, que serve a interface e faz a ponte com o GitHub | <http://127.0.0.1:4173> |
| Remoto | Páginas estáticas no GitHub Pages | <https://x3x31.github.io/vsx/> |
| **Multiusuário** | O Pages continua sendo a interface; cada aluno executa a ponte no próprio Codespace (§14) | <https://x3x31.github.io/vsx/> |

No modo local — **o caminho principal** — o vsx se comporta como o VS Code:
`npm start` abre o navegador, você clica em *Conectar com GitHub*, o GitHub
aparece numa janela mostrando a conta que já está logada, você clica em
*Authorize* e o vsx fica conectado. Sem colar token, sem tela intermediária.

A interface tem três áreas:

| Área | Função |
| --- | --- |
| Barra lateral (esquerda) | **Em cima**: a lista de repositórios do GitHub (só os com permissão de escrita), com busca. **Embaixo**: a árvore de arquivos do repositório + o painel de alterações do Git. As duas são separadas por uma divisória |
| Editor | CodeMirror 5 (tema Dracula), abas, realce de sintaxe, `Ctrl+S` |
| Terminal (parte inferior) | Sessão do OpenCode **restrita ao repositório selecionado** |

A barra lateral, a altura da lista de repositórios e a altura do terminal são
redimensionáveis (ver §4.6). As três áreas podem ser **recolhidas** e, no
celular, o layout vira uma **coluna** com o editor e o terminal embaixo da
barra lateral (ver §4.7). A barra superior fica sempre no topo e concentra as
ações principais: salvar a edição e deslogar.

---

## 2. A restrição que moldou tudo

O GitHub Pages serve **apenas arquivos estáticos**. Não roda Node, não roda
`git`, não roda o OpenCode. Ao mesmo tempo, a aplicação precisa:

- conversar com a API do GitHub (ler repositórios, ler/editar arquivos, commitar);
- executar o OpenCode, que só funciona como processo local, sobre os arquivos do
  repositório.

A solução é uma arquitetura de **dois modos**, com a mesma interface:

```
┌──────────────────────────────────────────────────────────────┐
│  interface (HTML/CSS/JS estático)                           │
│                                                              │
│   repos · árvore · editor · git · terminal                   │
└───────────┬──────────────────────────────┬───────────────────┘
            │                              │
     modo "github"                    modo "ponte"
  (direto no navegador)            (servidor Node local)
            │                              │
            ▼                              ▼
   api.github.com (CORS ok)      espelho git + opencode serve
```

| | Modo direto | Modo ponte |
| --- | --- | --- |
| Como é usado | No GitHub Pages, sem servidor | Com `npm start` na máquina |
| Repositórios, arquivos, editor, branch, commit | API do GitHub direto pelo navegador | Espelho local + git |
| Terminal do OpenCode | **precisa da ponte** | completo |

O `vsx` detecta a ponte sozinho (ver §6) e troca de modo automaticamente.

### 2.0 O modelo VS Code (o caminho principal)

Quando a interface é servida pela própria ponte, o vsx entra no **modo local** e
o caminho fica idêntico ao do VS Code:

```
npm start
  → abre o navegador em http://127.0.0.1:4173
  → a ponte já sabe quem é o usuário: o app abre conectado, sem pedir nada
  → se ainda não houver conexão, aparece só o botão "Conectar com GitHub"
  → a janela do GitHub abre com a conta que já está logada
  → "Authorize" → a janela fecha sozinha → o vsx está conectado
```

Três consequências importantes desse modo:

1. **O token nunca chega ao navegador.** A ponte troca o código por um token,
   guarda no servidor e responde à página apenas com `#vsx_connected=1`. A
   página então pergunta o estado à ponte (`GET /api/state`) e adota a
   conexão. O navegador só enxerga o login e o avatar.
2. **Não há CORS, nem Private Network Access, nem *gate*.** App e ponte são a
   mesma origem.
3. **A interface esconde o que não é preciso.** No modo local, os campos de
   Client ID e de endereço de retorno não aparecem: a ponte já tem o Client ID
   e o endereço de retorno é a própria origem.

### 2.0.1 O mesmo fluxo a partir do GitHub Pages

No modo remoto falta uma peça: a autorização volta para a própria página do
vsx e o `code` ainda precisa virar token em algum servidor — o navegador não
consegue fazer essa troca (`github.com/login/**` não tem CORS, ver §2.1).
Essa peça é o **broker** (`broker/worker.js`): um worker stateless, publicado
uma única vez, que só troca código por token.

```
janela do GitHub  →  redireciona para <página do vsx>/?code=…
página do vsx     →  POST /oauth/exchange {code, code_verifier}
broker            →  troca com github.com e devolve {token, login}
página do vsx     →  guarda o token no localStorage e conecta
```

O token fica no navegador de quem autorizou — é o VS Code que guarda a
credencial da conta, não o servidor — e nenhum terceiro o guarda. **Qualquer
visitante conecta a própria conta** com um único OAuth App do lado do vsx.

O broker já está publicado, em endereço fixo:
<https://vsx.x3x31.workers.dev> (`DEFAULT_BROKER_URL`, em `js/broker.js` — o
endereço fica no `localStorage`, em `vsx.broker`, para poder apontar para
outro). Ele expõe duas rotas:

| Rota | Descrição |
| --- | --- |
| `GET /oauth/config` | Devolve `{name: "vsx-broker", clientId}` — é de lá que a página tira o Client ID do OAuth App |
| `POST /oauth/exchange` | Troca `{code, code_verifier, clientId, redirectUri}` por `{token, scope, login}` |

As origens autorizadas ficam em `VSX_ALLOWED_ORIGINS` (`broker/wrangler.toml`)
e o segredo do OAuth App, se houver, em `VSX_CLIENT_SECRET` — nunca no
navegador.

A ponte local pode ocupar o lugar do broker quando é alcançável pelo
navegador (`npm run start:public` abre um **túnel público** com o
`cloudflared`, sem conta e sem *gate*, e imprime o endereço). É o mesmo
contrato (`POST /oauth/exchange`), então a troca funciona igual. No **modo
local** nem isso é preciso: app e ponte são a mesma origem.

### 2.1 O que o navegador proíbe (achados que custaram tempo)

Estes fatos foram verificados empiricamente e **não** são óbvious:

| Limitação | Consequência no desenho |
| --- | --- |
| `api.github.com` **aceita** CORS | O editor inteiro funciona sem servidor |
| `github.com/login/**` **não aceita** CORS — nem em requisição "simples" (`application/x-www-form-urlencoded` e `text/plain` foram testados) | A troca do código OAuth por token **não pode ser feita pelo navegador** |
| O GitHub **não suporta** o implicit grant (`response_type=token`) — confirmado na documentação | Não há como devolver o token direto na URL |
| O GitHub **suporta PKCE** (`code_challenge` / `code_verifier`, método `S256`) | Dá para fazer OAuth sem `client_secret` em lugar nenhum |
| O Chrome bloqueia `fetch` de uma **origem pública** para **endereços de loopback** (`127.0.0.1`) | Um `fetch` do GitHub Pages nunca alcança uma ponte local |
| O Chrome **libera navegação** (top-level) de origem pública para loopback | A volta da autorização por *redirect* funciona — foi a chave da solução |
| O Chrome 138+ exige permissão explícita para alcançar **rede privada** (Private Network Access) | A ponte responde `Access-Control-Allow-Private-Network: true` no preflight |
| O *gate* de porta do Codespace (`https://<porta>-app.github.dev`) **descarta a query string** no 302 | A URL pública do Codespace não serve de `redirect_uri` com a porta privada |
| `window.open` precisa ser chamado **dentro do gesto do clique** | O cálculo do `code_challenge` (assíncrono) é feito *depois* de abrir o popup em branco |

---

## 3. Estrutura do repositório

```
index.html          estrutura da interface (é o que o GitHub Pages publica)
.nojekyll           faz o Pages ignorar o Jekyll e publicar os arquivos como estão
css/app.css         tema Dracula da interface (~1.100 linhas)
js/                 aplicação do navegador (módulos ES nativos, sem bundler)
  api.js            token, github, bridge, broker e workspace — a composição central
  github.js         cliente da API do GitHub rodando no navegador
  bridge.js         cliente da ponte local (descoberta, segredos, SSE)
  broker.js         cliente do broker (o ponto que troca o code por token)
  workspace.js      camada que escolhe entre os dois modos
  repos.js          menu de repositórios
  tree.js           árvore de arquivos (pastas recolhidas, ícones)
  editor.js         CodeMirror: abas, dirty, salvar, modos por extensão
  icons.js          ícones de arquivo (Seti) e de pasta/chevron (codicons)
  layout.js         divisórias (largura da barra lateral, lista de repositórios e
                    terminal) e os painéis expansíveis
  git.js            painel de alterações
  terminal.js       terminal do OpenCode (streaming, ferramentas, permissões)
  dom.js            helpers (el, toast, formatação)
  main.js           amarração: boot, eventos, atalhos, modais
server/             ponte local (Node, sem dependências)
  index.js          HTTP, rotas, CORS, SSE, static
  github.js         cliente da API REST do GitHub (rodando no servidor)
  workspace.js      clone/pull/push, leitura/escrita, status do git
  opencode.js       gerencia o `opencode serve` e as sessões
  oauth.js          device flow e web flow (PKCE)
  config.js         configuração em ~/.config/vsx/config.json
broker/             troca do código por token para o modo remoto (Cloudflare Worker)
  worker.js         stateless: só troca o `code` pelo token, com PKCE
  wrangler.toml     Client ID do OAuth App e origens autorizadas
  README.md         como publicar (um minuto, gratuito)
test/               testes do repositório (`npm test` / `npm run test:e2e`)
  helpers.mjs       GitHub simulado, site estático, broker e ponte
  broker.test.mjs   rotas, CORS e a troca do worker
  ponte.test.mjs    modo remoto (devolve e não grava) e modo local (grava)
  oauth_pages.test.mjs  fluxo completo no navegador
vendor/codemirror/  CodeMirror 5 empacotado (funciona offline)
  theme/dracula.css  tema Dracula do CodeMirror
  mode/htmlmixed/    modo HTML/XML (precisa do xml.js)
vendor/seti/        fonte Seti: ícones de arquivo por tipo (o tema do VS Code)
vendor/codicon/     fonte de codicons: pastas e chevrons da árvore
teste.txt           arquivo solto na raiz (resto de um teste antigo)
```

---

## 4. O frontend

### 4.1 `js/workspace.js` — a camada que escolhe o modo

A classe `Workspace` (`js/workspace.js`) expõe a mesma interface nos dois
modos; quem decide o modo é o `detect()`/`setMode()` dela, chamado pelo
`main.js` conforme a ponte esteja ou não disponível:

```js
listRepos() · listBranches(fullName) · open(fullName, branch)
readFile(path) · writeFile(path, content) · createFile(path, content)
removeFile(path) · listChanges() · commit(message) · discard(path)
```

- No **modo ponte** delega para a ponte (`/api/workspace/*`).
- No **modo direto** usa a API do GitHub e mantém um `Map` de alterações
  pendentes (`this.changes`), que viram um commit único.

### 4.2 Commit no modo direto

A API de Contents cria um commit por arquivo. Para commitar vários de uma vez,
o vsx usa a API de dados do Git:

1. `POST /repos/{o}/{r}/git/blobs` — um blob por arquivo alterado
2. `POST /repos/{o}/{r}/git/trees` — a árvore nova, com `base_tree` da atual
3. `POST /repos/{o}/{r}/git/commits` — o commit, com o `parent` atual
4. `PATCH /repos/{o}/{r}/git/refs/heads/{branch}` — move a branch

### 4.3 `js/terminal.js` — o terminal

- Conversa com a **ponte** (nunca direto): `session()`, `prompt()`, `interrupt()`,
  `permissions()`, `replyPermission()`, `messages()`, `setModel()`, `setAgent()`.
- Recebe os eventos pelo SSE da ponte (`/api/stream`), filtrados por `sessionID`.
- Eventos relevantes no **OpenCode 2.1.3**: `session.text.started` / `.delta` /
  `.ended`, `session.reasoning.started` / `.delta` / `.ended`,
  `session.tool.input.started` / `.delta` / `.ended`, `session.tool.called` /
  `success` / `failed`, `session.execution.started` / `succeeded` / `failed` /
  `interrupted`, `session.step.started` / `.ended` / `.failed`,
  `session.retry.scheduled` e `session.usage.updated`.
- O frontend ainda escuta `session.tool.error`, que **não existe** na v2 (o
  nome correto é `session.tool.failed`), e ainda não trata
  `session.step.failed`, `session.execution.interrupted` nem
  `session.retry.scheduled`; essas correções estão na lista do §13.
- Sem ponte: mostra o motivo e desabilita a entrada.

### 4.4 `js/editor.js` — abas, dirty e modos

Cada aba guarda `{path, content, dirty, scroll}`. O dirty é controlado por um
flag `suppressChange`, para que gravar o valor programaticamente não marque a
aba como alterada.

O CodeMirror roda com o **tema Dracula** (`theme: "dracula"`) e o modo de
sintaxe é escolhido pela extensão do arquivo (`modeFor(path)`): um mapa de
**quarenta extensões** para os modos do CodeMirror — `javascript`, `jsx`,
`css`, `htmlmixed` (`.html`, `.htm`, `.vue`), `xml`, `python`, `markdown`,
`shell`, `yaml`, `sql`, `toml`, `go`, `rust`, `dockerfile` e outros. Arquivos
sem extensão conhecida (`txt`, `lock`) abrem sem realce.

### 4.5 `js/tree.js` e `js/icons.js` — a árvore com cara de VS Code

- **Ícones por tipo de arquivo**: o tema Seti do próprio VS Code, vendorizado
  em `vendor/seti/` (fonte `seti.woff`). `js/icons.js` mapeia nome/extensão →
  caractere + cor (valores extraídos do `vs-seti-icon-theme.json` do VS Code).
- **Pastas e chevrons**: codicons (`vendor/codicon/`), com pasta fechada /
  aberta e chevron `>` que abre e fecha cada pasta.
- **Pastas começam recolhidas**; o estado fica num `Set` em memória
  (`expanded`), por sessão, e é preservado quando a lista de arquivos muda.
  Abrir um arquivo por fora da árvore expande os pais (`reveal`).
- A ordenação é a do VS Code: **pastas primeiro**, depois os arquivos por
  nome (`localeCompare` com `"pt-BR"`, numérico).
- A árvore tem `role="tree"` (as linhas, `role="treeitem"`) e é montada a
  partir da lista de arquivos que o workspace devolve (`state.files` — a
  ponte no modo ponte, a API do GitHub no modo direto), não do filesystem do
  navegador.

### 4.6 `js/layout.js` — as divisórias

O layout é uma linha com **duas colunas**: a barra lateral (repositórios em
cima, arquivos embaixo) e o editor com o terminal. Três divisórias mudam os
tamanhos, como no VS Code:

| Divisória | O que move | Limites |
| --- | --- | --- |
| `#splitter-sidebar` (vertical) | a **largura** da barra lateral | 200 px até `largura da janela − 320` (o editor fica com pelo menos 320 px) |
| `#splitter-repos` (horizontal) | a **altura** da lista de repositórios dentro da barra lateral | 90 px até `altura da barra lateral − 160` |
| `#splitter-terminal` (horizontal) | a **altura** do terminal (o editor fica com o resto) | 120 px até `altura do painel principal − 160` |

Cada divisória:

- arrasta com o mouse (ou o dedo — eventos de ponteiro, com captura);
- anda com as **setas** quando está focada (`Shift` + seta = passo maior);
- volta ao **padrão** com um duplo clique;
- tem `role="separator"`, `aria-orientation` e `aria-label`.

Os tamanhos ficam no `localStorage`, na chave `vsx.layout`
(`{sidebarWidth, reposHeight, terminalHeight}`), então a página volta do jeito
que o usuário deixou — inclusive depois de recarregar. A altura inicial da
lista de repositórios é 38% da barra lateral, e a do terminal é 38% do painel
principal (o CSS), até o usuário mexer nelas.

### 4.7 `js/layout.js` — painéis expansíveis e layout de celular

#### Painéis expansíveis

Os três painéis podem ser **recolhidos** e abertos de novo:

| Painel | Botão | Recolhido |
| --- | --- | --- |
| Barra lateral | `#btn-toggle-sidebar` (barra superior, à esquerda) | some inteira e o editor ocupa o lugar |
| Editor | `#btn-toggle-editor` (barra de abas, à direita) | sobra só a barra de abas |
| Terminal | `#btn-toggle-terminal` (cabeçalho do terminal) | sobra só o cabeçalho |

O estado vive no mesmo `localStorage` (`vsx.layout`, chave `collapsed`), então
volta como o usuário deixou. O botão mostra o estado com `aria-pressed` e
troca o ícone (`▾` aberto / `▴` fechado). Quando o espaço do editor muda, o
CodeMirror precisa se reajustar: `setupLayout` recebe um `onResize` e quem
chama é o `main.js`, com `editor.refresh()`.

#### Celular

Abaixo de **860 px** (`@media (max-width: 860px)`) o layout deixa de ser uma
linha e vira uma **coluna**:

```
barra superior (grudada no topo)
barra lateral  (repositórios e arquivos)
editor
terminal
```

- a página inteira **rola** (`html, body { height: auto; overflow: visible }`):
  nenhum painel fica fixo na tela, todos acompanham o scroll;
- a **barra superior** é `position: sticky; top: 0` — ela acompanha a rolagem
  e nunca sai do topo;
- as **divisórias somem** (`display: none`): sem espaço para arrastar, quem
  ajusta o espaço agora são os botões de recolher;
- as alturas vêm do CSS: repositórios `40vh`, arquivos `50vh`, editor `60vh`,
  terminal `45vh`;
- os botões da barra superior perdem o texto (só o ícone) e os alvos de toque
  crescem para 30 px;
- em modo coluna os **tamanhos em pixels não são gravados** — `js/layout.js`
  ignora as divisórias enquanto `matchMedia("(max-width: 860px)")` casar, para
  o terminal não herdar uma altura de 1000 px quando a tela crescer de novo.

#### Ações da barra superior

| Botão | O que faz |
| --- | --- |
| `#btn-toggle-sidebar` | mostra ou esconde a barra lateral |
| `#btn-save` | salva a edição do arquivo aberto (o mesmo que `Ctrl+S`); só fica disponível quando a aba ativa tem alteração não salva |
| `#btn-logout` | desloga do repositório (apaga o token do navegador e volta para a tela de conexão); só aparece quando há conta conectada |

---

## 5. A ponte (servidor Node)

Rode com `npm start` (porta 4173). Sem dependências externas: só Node ≥ 20,
`git` no PATH e `opencode` instalado.

### 5.1 Rotas

| Rota | Descrição |
| --- | --- |
| `GET /api/bridge/info` | Identifica a ponte (usado na detecção) |
| `GET /oauth/callback` | **Volta da autorização no modo local**: troca o código por um token, guarda no servidor e redireciona para o vsx com `#vsx_connected=1` (o token não vai na URL) |
| `POST /oauth/exchange` | **Troca no modo remoto**: a página entrega o código que voltou na query e recebe `{token, scope}`. O token vai para o navegador de quem autorizou e **não** é gravado na ponte — mesmo contrato do broker (§2.0.1) |
| `GET /api/state` | Estado geral (conectado, usuário, repositório, opencode) |
| `POST /api/github/connect` | Valida e guarda um token |
| `POST /api/github/disconnect` | Desconecta |
| `GET /api/github/repos` | Repositórios com permissão de escrita |
| `GET /api/github/branches` · `commits` · `contents` · `user` | consultas |
| `POST /api/workspace/open` | Clona/atualiza o espelho e abre o repositório |
| `GET /api/workspace/files` · `file` · `status` · `diff` | leitura |
| `PUT /api/workspace/file` | salva um arquivo |
| `POST /api/workspace/new` · `DELETE /api/workspace/file` | cria/remove |
| `POST /api/workspace/commit` | Commit + push para o GitHub |
| `POST /api/workspace/discard` | Descarta alterações |
| `GET /api/opencode/status` · `session` · `messages` · `permission` | OpenCode |
| `POST /api/opencode/prompt` · `interrupt` · `session/new` · `model` · `agent` · `permission` | OpenCode |
| `GET /api/oauth/config` · `POST /api/oauth/client` | Client ID do OAuth App |
| `POST /api/oauth/device/start` · `device/poll` | device flow (alternativa) |
| `GET /api/stream` | SSE com os eventos do app e do OpenCode |

> `POST /api/oauth/client` continua no servidor, mas a interface não a usa
> mais: a janela de conexão ficou só com o botão *Conectar com GitHub*
> (§7.4). O Client ID vem da ponte (modo local) ou do broker (modo remoto).

### 5.2 O OpenCode

`server/opencode.js` sobe um `opencode serve` dedicado (porta livre, senha lida
da saída do processo, usada como Basic auth) e cria as sessões com:

```js
await opencode.sessionFor(diretórioDoEspelho)   // location.directory = espelho
```

É isso que garante o requisito central: **o agente só enxerga e só escreve nos
arquivos do repositório selecionado** (a sessão nasce com esse diretório como
`location.directory`; as ferramentas de shell ainda podem alcançar outros
caminhos do sistema — ver §13.3).

O contrato foi conferido contra o **OpenCode 2.1.3**: `GET /api/info`,
`GET /api/model?location[directory]=…`, `GET /api/agent?location[directory]=…`,
`POST /api/session` (com `location.directory`), `GET /api/session?directory=…`,
`POST /api/session/{id}/prompt` (`{text}`, opcionalmente `files`),
`POST /api/session/{id}/model` (`{id, providerID}`) e
`POST /api/session/{id}/permission/{requestID}/reply`
(`{decision: "once" | "always" | "reject"}`). O `opencode serve` imprime
`server password …`, que a ponte usa como Basic auth.

Sem um **provedor de modelo autenticado**, o `opencode serve` sobe e a sessão é
criada, mas o prompt falha com `provider.internal` / `Upstream request failed`
e o terminal fica em “processando…” — o pré-requisito e a correção estão em
§13.

O processo é recriado **sob demanda**: `request()` e `events()` chamam
`start()` quando não há servidor de pé, e o *pump* que repassa os eventos do
OpenCode (`/api/event`) para o navegador (`GET /api/stream`) reagenda a si
mesmo em 4 s quando a conexão cai. Se o `opencode serve` morre, a ponte o
sobe de novo — o que se perde é a **sessão** (o processo novo não a conhece),
não o terminal.

### 5.3 O espelho git

`server/workspace.js` clona em `~/.local/share/vsx/workspaces/<dono>/<repo>`
(shallow, `--depth 50`). O token entra via `-c http.extraHeader=...`, sem
gravar credencial no `.git/config`. Após clonar, o refspec é alargado para
`+refs/heads/*:refs/remotes/origin/*`, senão só a branch padrão fica
disponível.

---

## 6. Descoberta da ponte

`js/bridge.js` tenta, nesta ordem:

1. o endereço configurado (padrão `http://127.0.0.1:4173`);
2. se falhar, em paralelo: `http://127.0.0.1:4173`, `http://localhost:4173`,
   `https://4173-app.github.dev` (URL pública de porta do Codespace).

Distingue **alcançável** (respondeu) de **utilizável** (respondeu sem exigir
senha). O indicador no topo mostra `ponte: on-line`, `ponte: senha` ou
`ponte: off-line`.

> A checagem é feita por `fetch` e dá **falso negativo**: o `fetch` é
> bloqueado em casos em que a *navegação* funciona. Por isso, no **modo
> local**, ela nunca bloqueia o botão **Conectar com GitHub** — a autorização
> é navegação e continua funcionando.
>
> No **modo remoto** o botão confere apenas o ponto de troca do `code` por
> token (broker configurado ou ponte acessível). Sem ele a autorização não
> teria como terminar, então o vsx explica o que falta — em vez de abrir o
> GitHub e falhar depois, com o usuário já tendo autorizado.

---

## 7. O fluxo OAuth

### 7.1 Web flow com PKCE (o que está em uso)

O `redirect_uri` (endereço de retorno) depende do modo, e essa é a diferença
importante entre eles:

| Modo | Endereço de retorno | Por quê |
| --- | --- | --- |
| **Local** | `http://127.0.0.1:4173/oauth/callback` | A ponte é a própria origem: sem CORS, sem *gate* |
| **Remoto** | A URL da própria página do vsx (`https://x3x31.github.io/vsx/`) | O *gate* de porta do Codespace descarta a query string numa **navegação**, mas não num `fetch` |

Fluxo completo:

```
clique em "Conectar com GitHub"
  │
  ├─ abre a janela já em branco (dentro do gesto do clique) e só então
  │  resolve o Client ID (broker ou ponte) e gera code_verifier/challenge
  │
  ├─ aponta a janela para o GitHub:
  │    https://github.com/login/oauth/authorize
  │      ?client_id=…&redirect_uri=<endereço de retorno>
  │      &scope=repo&state=<base64url({v,r,c,u})>
  │      &code_challenge=…&code_challenge_method=S256
  │
  ├─ o usuário autoriza (ou faz login) no GitHub
  │
  ├─ o GitHub devolve o código:
  │    ├─ local  → <ponte>/oauth/callback?code=…   (navegação, mesma origem)
  │    └─ remoto → <página do vsx>/?code=…          (navegação, qualquer origem)
  │
  ├─ alguém troca o código por um token
  │      POST https://github.com/login/oauth/access_token
  │        {client_id, code, redirect_uri, code_verifier}   ← sem client_secret
  │    ├─ local  → GET  /oauth/callback   (a ponte troca, guarda e redireciona)
  │    └─ remoto → POST /oauth/exchange, com o broker primeiro, a ponte
  │                (se alcançável) e o workspace **Codespaces** (se on-line)
  │                como canal — e o token é devolvido, nunca guardado
  │
  └─ a página fica conectada:
        ponte    → <vsx>/#vsx_connected=1 → adota a conexão da ponte
        remoto   → o token vai para o navegador (localStorage) e o app fala
                 direto com api.github.com
```

O `state` carrega `{v: verifier, r: returnTo, c: clientId, u: redirectUri}` em
base64url — o `verifier` viaja assim até a troca, que acontece na mesma janela
que iniciou a autorização (é o que o PKCE garante). **Não existe `client_secret`
no navegador**: se o OAuth App exigir, ele fica no broker
(`wrangler secret put VSX_CLIENT_SECRET`).

**O token não vai na URL.** No modo local, a URL leva apenas `#vsx_connected=1`
e quem tem o token é a ponte (a interface pergunta o estado via `GET /api/state`).
No modo remoto, o token é devolvido por `POST /oauth/exchange` para a página
que autorizou — é ela que passa a guardá-lo no `localStorage`, como o VS Code
guarda a credencial da conta, e é ela que o devolve à ponte por requisição
(`x-vsx-token`) quando usa o terminal.

> **Por que o modo remoto importa:** com a volta no app, a troca deixa de
> depender do *gate* do Codespace (que bloqueia a navegação para porta
> privada e descarta o `?code=`) e deixa de exigir que cada visitante rode
> uma ponte: o broker é público e único, e a ponte local continua sendo o
> caminho completo (terminal incluso) para quem quer rodá-la.

### 7.2 Como o app sabe que a ponte é "a própria ponte"

`js/bridge.js` → `detectLocal()`: faz `GET <origem atual>/api/bridge/info` e
confere se a resposta é a da ponte (`name: "vsx-bridge"`). Se for, a ponte e a
página são a mesma origem e o modo local está ativo.

### 7.3 Device flow (alternativa, ainda na ponte)

`POST /api/oauth/device/start` → código de 8 caracteres → o usuário digita em
`github.com/login/device` (a página aceita `?user_code=` para pré-preencher) →
`POST /api/oauth/device/poll` entrega o token. Exige que a ponte responda por
`fetch`, então só funciona se ela for alcançável assim.

### 7.4 Token de acesso pessoal (sem entrada na interface)

A janela de conexão só oferece o OAuth. Um PAT com escopo `repo` continua sendo
aceito pela ponte (`~/.config/vsx/config.json` → `token`, ou `GITHUB_TOKEN` no
ambiente) e, no navegador, colando-o à mão em `localStorage.setItem("vsx.token", …)`
— nesse caso o app entra no modo direto.

---

## 8. Configuração da ponte

Arquivo `~/.config/vsx/config.json` (permissão `600`):

```json
{
  "token": "ghp_…",
  "user": { "login": "x3x31", "name": "…", "avatar": "…", "email": null },
  "disabled": false,
  "clientId": "Ov23liY3KVcMBqRaEwBi",
  "clientSecret": null,
  "bridgeSecret": "8ed572c0e08818f6557d7bd5dc0702dae4041b03663fba56",
  "lastRepo": "x3x31/vsx",
  "lastBranch": "main",
  "model": null,
  "agent": null
}
```

| Chave | Significado |
| --- | --- |
| `token` | Token do GitHub guardado pela ponte (vem do PAT ou do OAuth) |
| `user` | Último usuário identificado |
| `disabled` | `true` quando o usuário desconectou — sobrepõe o `GITHUB_TOKEN` do ambiente |
| `clientId` | Client ID do OAuth App |
| `clientSecret` | Segredo do OAuth App (só se não usar PKCE; também aceito por `GITHUB_OAUTH_CLIENT_SECRET`) |
| `bridgeSecret` | Senha da ponte, gerada uma vez e mantida entre reinícios |
| `lastRepo` / `lastBranch` | Último repositório aberto (reabrir é manual) |
| `model` / `agent` | Último modelo/agente usados no OpenCode |

Variáveis de ambiente:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4173` | Porta da ponte |
| `HOST` | `127.0.0.1` | Interface — use `0.0.0.0` para expor (exige senha) |
| `BRIDGE_SECRET` | gerada e guardada no config | Senha da ponte exposta |
| `VSX_PUBLIC` | — | `1` (ou `--public`) sobe um túnel público com o `cloudflared` e imprime o endereço |
| `GITHUB_TOKEN` | — | PAT usado quando nenhum token é digitado (`GH_TOKEN` também é aceito) |
| `GITHUB_OAUTH_CLIENT_ID` | — | Client ID do OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | Só se o OAuth App não usar PKCE |
| `CORS_ORIGINS` | ver abaixo | Origens autorizadas a chamar a ponte |
| `VSX_CONFIG_DIR` | `~/.config/vsx` | Onde fica o `config.json` (útil para testes isolados) |
| `VSX_WORKSPACE_DIR` | `~/.local/share/vsx/workspaces` | Onde ficam os espelhos git |
| `VSX_OPEN_BROWSER` | `1` | `0` para não abrir o navegador ao subir |
| `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` | — | Preenchido pelo Codespace: a ponte imprime a URL pública `<porta>-<domínio>` |

Origens liberadas por padrão:

```
http://127.0.0.1:4173, http://localhost:4173,
http://127.0.0.1:5173, http://localhost:5173,
https://x3x31.github.io
```

---

## 9. Segurança

| Medida | Motivo |
| --- | --- |
| No **modo local**, o token do OAuth **não volta na URL nem chega ao navegador** | Quem tem o token é a ponte; a página só recebe `#vsx_connected=1` |
| No **modo remoto**, o token volta pelo `POST /oauth/exchange` para o navegador de quem autorizou | É o navegador que o guarda no `localStorage` e o envia à ponte por `x-vsx-token`; a ponte não o grava |
| Senha obrigatória quando a ponte escuta fora do loopback | Quem está na rede poderia rodar o OpenCode na máquina |
| `timingSafeEqual` na comparação da senha | Evita comparação por tempo |
| Lista de origens no CORS | Só o GitHub Pages e o localhost falam com a ponte |
| Lista de origens no broker (`VSX_ALLOWED_ORIGINS`) | O worker público não troca código de qualquer origem — só das cadastradas |
| `Access-Control-Allow-Private-Network` no preflight | Necessário para alcançar a ponte em rede privada |
| Token do GitHub no `localStorage` no modo direto e no modo remoto | No modo local (a ponte serve a página), ele fica só no servidor; no modo remoto ele fica no navegador e a ponte só o usa por requisição |
| Caminhos validados com `safeJoin` | Impede travessia de caminho (`../../../etc/passwd` → 403) |
| O `/oauth/callback` não exige senha | É acessado por navegação; a segurança vem do `code` + `code_verifier` |

---

## 10. Publicação

- O Pages está configurado como `main` → `/`, build legacy, com `.nojekyll` na
  raiz: publica os arquivos como estão, sem Jekyll, e o `index.html` da raiz
  vira a página inicial em `/vsx/`.
- Os caminhos de assets são **relativos** (`./css/app.css`), para funcionar em
  qualquer subpath.
- Publicar = enviar um commit para `main`. Não há workflow de deploy (o token
  do Codespace não tem permissão para mudar as configurações do Pages).

---

## 11. Como testar

```sh
npm start                     # ponte em http://127.0.0.1:4173
npm test                      # broker + ponte + codespace (Node, sem rede externa)
npm run test:e2e              # fluxo completo no navegador (oauth_pages, layout, codespace_pages)
```

`npm run test:e2e` precisa do Chromium do Playwright
(`npx playwright install chromium`). Ele sobe o **broker** (o worker real de
`broker/worker.js`), serve o site em outra origem — a topologia do GitHub
Pages — e coloca um **GitHub simulado** no lugar do GitHub; depois clica em
**Conectar com GitHub** e confere que a autorização, a troca do código por
token e a conexão acontecem, com o token no `localStorage` e não em servidor
nenhum. O mesmo comando roda o teste do **layout responsivo** (§4.7), que
confere o empilhamento no celular, a barra superior grudada no topo e os
painéis expansíveis, e o mesmo comando roda também o teste do **provedor Codespaces no Pages** (`test/codespace_pages.test.mjs`).

| Arquivo | O que cobre |
| --- | --- |
| `test/broker.test.mjs` | rotas e CORS do broker, troca com PKCE, form-encoded do GitHub, origem não autorizada |
| `test/ponte.test.mjs` | modo remoto: a ponte devolve o token e **não** grava; modo local: grava e redireciona com `#vsx_connected=1` |
| `test/oauth_pages.test.mjs` | um clique no Pages conecta a conta; sem broker nem ponte, o vsx explica o que falta antes de abrir o GitHub |
| `test/layout.test.mjs` | layout responsivo: no celular o editor e o terminal descem para baixo da barra lateral, a barra superior fica no topo e nada fica fixo; os três painéis recolhem e o estado fica guardado |
| `test/codespace.test.mjs` | a ponte adaptada ao Codespaces: escuta em `0.0.0.0`, URL pública, token obrigatório, CORS restrito; `GET /api/bridge/info` com `publicUrl`, `codespace`, `host` e `port` |
| `test/codespace_pages.test.mjs` | no GitHub Pages: o modal “Conectar workspace no Codespaces” (URL + token), salvamento em `localStorage`, detecção de workspace parado/expirado ou token recusado, e o fluxo do aluno |

> **O OpenCode real não entra no `npm test`**: os testes atuais usam GitHub e
> broker simulados e não exercitam um provedor de modelo. O primeiro teste de
> ponta a ponta do agente (ler e alterar um arquivo) ainda precisa ser criado —
> §13.3, item 8.

Os testes que exercitam o OpenCode real e o GitHub real continuam fora do
repositório, em `/tmp/opencode`:

| Arquivo | O que cobre |
| --- | --- |
| `smoke.mjs` | fluxo completo no modo ponte: conectar, abrir repo, editar, salvar, commitar, terminal, branch |
| `test_agent.mjs` | o OpenCode cria um arquivo e a interface reflete (árvore, editor, git) |
| `test_branch.mjs` | troca de branch e criação de arquivo pela interface |
| `test_direct.mjs` | modo direto: sem ponte, tudo contra a API do GitHub, com commit real |
| `test_sdk.mjs` | **modelo VS Code**: app local, autorizar, a janela fecha, o token fica na ponte |
| `test_lembra.mjs` | app local já abre conectado (a ponte lembra do login) |
| `test_remoto.mjs` | modo remoto no Pages: a janela do GitHub abre com os parâmetros certos |
| `test_remoto2.mjs` | **modo remoto completo**: o código volta para a página do app e a ponte faz a troca |
| `test_oauth_web.mjs` | fluxo OAuth completo com GitHub simulado |
| `test_final_oauth.mjs` | fluxo OAuth a partir do GitHub Pages |
| `test_git.mjs` | 13 operações de git contra um remote local |
| `test_push.mjs` | commit + push real no GitHub (branch temporário, removido no fim) |

> O container tem pouca memória (~7,9 GB, o VS Code server usa 2 GB). Se o
> Chromium crashar com *"Target crashed"*, mate os `opencode serve`
> órfãos: `pkill -f "opencode serve --hostname"` — e **não** use `pkill -f`
> com um padrão que case com a própria linha de comando, o shell se mata.

---

## 12. Em aberto

1. **O modo local está validado ponta a ponta** (GitHub simulado): abrir →
   *Conectar com GitHub* → a janela do GitHub → autorização → a janela fecha
   sozinha → o app fica conectado, com o token apenas no servidor e os 11
   repositórios carregados. Falta só a confirmação com o GitHub real, que
   exige uma sessão web no navegador.
2. **No modo remoto (Pages) o caminho completo é broker + API direta.** A
   autorização volta para a própria página do vsx e o broker troca o código
   por token (§2.0.1); o restante é `api.github.com`. A ponte local continua
   servindo de broker alternativo quando é alcançável (`npm run start:public`
   ou porta pública do Codespace), e é o caminho para o terminal do OpenCode.
   Para o uso multiusuário, o caminho completo passa a ser o **Codespace por
   aluno** (§14); a API direta continua sendo o modo sem terminal.
   O GitHub aceita **um** callback URL por OAuth App: quem usa os dois modos
   precisa de dois apps (um com `http://127.0.0.1:4173/oauth/callback`, outro
   com `https://x3x31.github.io/vsx/`) — os GitHub Apps aceitam vários.
3. **O túnel público do `cloudflared` muda de endereço a cada reinício.** O
   vsx guarda o endereço no `localStorage`, então é preciso informar o novo
   quando a ponte reiniciar. Um túnel nomeado (com conta na Cloudflare) daria
   um endereço fixo. (O **broker** já tem endereço fixo — §2.0.1.)
4. ~~**O broker não deve guardar o token de terceiros.**~~ — resolvido: o
   broker é stateless (`broker/worker.js`) e o `POST /oauth/exchange` da
   ponte devolve o token para o navegador em vez de gravá-lo. Ninguém guarda
   credencial de terceiro; o token fica no `localStorage` de quem autorizou,
   como no VS Code.
5. **Os testes do OAuth agora vivem no repositório** (`test/`, `npm test` e
   `npm run test:e2e`). Ainda estão fora os testes que dependem do OpenCode
   real e do GitHub real (`/tmp/opencode`) — vale migrá-los.
6. ~~**Falta um `package.json` com `npm test`.**~~ — feito: `npm test`
   (broker + ponte + codespace) e `npm run test:e2e` (navegador).
7. **O device flow continua no código** mas o app não o usa mais — pode ser
   removido junto com as rotas `/api/oauth/device/*`.
8. **A busca de commits e o histórico de branches da API do GitHub** estão
   expostos no backend mas não usados na interface.
9. **A ponte reinicia o OpenCode quando ele cai** — a sessão pode se perder.
   O `sessionFor` tenta reencontrá-la em `GET /api/session?directory=…`, mas
   isso ainda não foi testado com o processo morto no meio de uma execução.
10. **O terminal não avisa quando o provedor de modelo falha.** O OpenCode
    emite `session.retry.scheduled` com `provider.internal` / 503 e a interface
    continua mostrando “processando…”. Falta tratar esse evento e validar o
    modelo antes de habilitar o prompt (§13.3).
11. **O frontend escuta `session.tool.error`, que não existe na v2.** O evento
    correto é `session.tool.failed`; `session.step.failed` e
    `session.execution.interrupted` também não são tratados (§4.3, §13.3).
12. **`location.directory` não é uma jaula.** Ele define o diretório da sessão,
    mas as ferramentas de shell do agente podem ler/escrever fora dele. Para
    prometer isolamento de verdade é preciso sandbox/container ou regras de
    permissão (§13.3).

### 12.1 Bugs encontrados e corrigidos (para não repetir)

| Sintoma | Causa |
| --- | --- |
| A janela de autorização não abria | O `await` do `code_challenge` quebrava o gesto do clique e o Chrome bloqueava o pop-up. Agora abre em branco e só depois aponta para a URL |
| `Cannot access 'state' before initialization` | Uma `const state` local sombreava o objeto de estado da aplicação |
| O servidor caía depois da autorização | A rota do callback respondia com 302 e o handler ainda tentava mandar JSON — `ERR_HTTP_HEADERS_SENT` derrubava o processo. Agora o handler confere `res.headersSent` |
| O botão "Conectar com GitHub" não fazia nada | A checagem da ponte (por `fetch`) bloqueava o fluxo, mas ela dá falso negativo: o `fetch` é bloqueado onde a *navegação* funciona |
| A ponte com senha era tratada como inexistente | "Alcançável" e "utilizável" viraram estados separados |
| No Pages, a autorização falhava com `ERR_CONNECTION_REFUSED` em `127.0.0.1:4173/oauth/callback` | O `redirect_uri` vinha do `localStorage`, de um teste antigo no modo local. O endereço de retorno agora é salvo **por modo** (`vsx.oauth.callback.local` / `.remote`), e o padrão do modo remoto é a URL da própria página |
| O GitHub respondia *"the redirect_uri is not associated with this application"* | O vsx tirava a barra final do endereço antes de enviar. O GitHub compara o `redirect_uri` **caractere a caractere** com o cadastrado: o valor agora vai exatamente como aparece no campo |
| A ponte exigindo senha era tratada como inexistente, e a janela do GitHub tapava a da configuração | A detecção local também reconhece o `401`: a ponte está lá, só pede a senha. O indicador passa a mostrar *ponte: senha* e a janela certa abre primeiro |
| No Pages, a autorização era concedida e a troca falhava com `Failed to fetch` | O navegador **nunca** pode trocar o código por token (`github.com/login/**` não tem CORS). A troca passou a ter um ponto servidor dedicado — o broker (`broker/worker.js`) — e a ponte oferece o mesmo contrato (`POST /oauth/exchange`, que agora devolve `{token}` em vez de guardar) |
| A troca do token respondia `404 Not Found` vinda do GitHub | O corpo ia como `application/json`. O endpoint é documentado com corpo form-encoded (o `Accept: application/json` pede a resposta em JSON). Agora vai `application/x-www-form-urlencoded`, com fallback para ler resposta form-encoded |
| No modo remoto a janela de autorização podia nem abrir | O fluxo remoto passou a consultar o Client ID ao broker — mais um `await` depois do clique, e o Chrome bloqueava o `window.open`. A janela agora é aberta em branco no início do handler e só depois aponta para o GitHub; o Client ID também é buscado em segundo plano ao abrir o modal |
---

## 13. Próximos passos — OpenCode lendo e alterando o repositório selecionado

O encanamento principal **já existe**: a ponte sobe o `opencode serve`, cria a
sessão com `location.directory` apontando para o espelho (§5.2), o terminal
envia o prompt e recebe os eventos por SSE, o `fs.watch` avisa a interface
quando um arquivo muda e o painel de Git commita/pusha o resultado. O que falta
é, em boa parte, **pré-requisito de ambiente + endurecimento da experiência**,
nesta ordem:

### 13.1 Pré-requisitos para o agente funcionar

| Item | Como verificar | Sem isso |
| --- | --- | --- |
| OpenCode ≥ 2.1.3 no `PATH` | `opencode --version` | a ponte responde 503 e o terminal mostra “executável não encontrado” |
| Provedor de modelo autenticado | `opencode auth login` (uma vez) e `opencode models` | a sessão é criada, mas o prompt fica em `retry` com `provider.internal`/503 |
| Modelo escolhido | seletor de modelo no terminal; ou `POST /api/opencode/model` com `{id, providerID}` | o OpenCode usa o padrão do seu config; se não houver, falha |
| Node ≥ 20, `git` e `npm install` | `node --version`, `git --version` | a ponte não sobe ou não clona |
| Aplicação servida **pela ponte** | abrir `http://127.0.0.1:4173` (`npm start`) | no Pages o terminal só funciona com `npm run start:public` + senha (§6) |
| Repositório aberto e espelhado | abrir o repo na interface; conferir `~/.local/share/vsx/workspaces/<dono>/<repo>` | sem espelho não há diretório para a sessão |

Sondas rápidas, com a ponte no ar:

```sh
curl -s http://127.0.0.1:4173/api/state
curl -s http://127.0.0.1:4173/api/opencode/status
curl -s http://127.0.0.1:4173/api/opencode/session   # deve trazer { session, models, agents }
```

Se `models` vier vazio, o problema é de provedor/credencial, não do vsx.

### 13.2 Fluxo de uso que já deve funcionar

1. `npm start` e abrir `http://127.0.0.1:4173`.
2. Conectar com GitHub e abrir um repositório com permissão de escrita — isso
   clona/atualiza o espelho e inicia o `fs.watch`.
3. Abrir o terminal: a ponte cria (ou reaproveita) uma sessão cujo
   `location.directory` é o espelho. O cabeçalho do terminal mostra o repo.
4. Escrever o pedido, por exemplo:
   > Leia o `README.md`, acrescente uma seção “Exemplos” e altere apenas esse
   > arquivo. Não faça commit.
5. Acompanhar as ferramentas (`read`, `edit`, `bash`…) no terminal. Se o
   agente pedir permissão, os cartões “Permitir / Sempre / Negar” aparecem no
   rodapé do terminal.
6. Quando o agente escreve, o `fs.changed` atualiza a árvore e recarrega a aba
   aberta (se ela não estiver *dirty*); o `git.status` atualiza o painel de
   alterações.
7. Revisar o diff e commitar pela interface (`POST /api/workspace/commit`), que
   faz `git add -A`, commit e `git push` com o token da conta.

Critério de pronto do fluxo: **o agente lê um arquivo e responde o conteúdo**;
**o agente altera um arquivo e a árvore/editor/Git refletem a mudança**; **o
commit pela interface chega ao GitHub**; e **uma falha de modelo aparece como
mensagem no terminal**, não como “processando…” eterno.

### 13.2.1 Guia prático: usar o OpenCode para ler e alterar arquivos

Para conseguir **ler e alterar arquivos do repositório selecionado** com o OpenCode nesta aplicação, siga estes passos:

#### Preparação (uma vez)
1. **Instalar dependências**: `npm install` na raiz do projeto.
2. **Instalar o OpenCode**: certifique-se de ter `opencode` >= 2.1.3 no `PATH`. Verifique com `opencode --version`.
3. **Configurar provedor de modelo**: execute `opencode auth login` e autentique pelo menos um provedor (ex.: Anthropic, OpenAI, etc.). Sem provedor autenticado, o agente não responde.
4. **Conectar ao GitHub**: rode `npm start` e abra `http://127.0.0.1:4173`. Faça login com GitHub (OAuth) ou garanta que a ponte tem token válido.

#### Uso no dia a dia
1. **Abrir repositório**: na barra lateral, selecione um repositório com permissão de escrita. A ponte irá clonar/atualizar o espelho em `~/.local/share/vsx/workspaces/<dono>/<repo>`.
2. **Iniciar sessão**: abra o terminal inferior. A ponte criará/recuperará uma sessão com `location.directory` apontando exatamente para esse espelho (garantindo o escopo ao repositório).
3. **Escolher modelo/agente**: use os seletores no cabeçalho do terminal para escolher modelo e agente conforme necessário.
4. **Pedir para ler/alterar**: envie instruções claras. Exemplos:
   - "Leia o arquivo `src/app.js` e explique o que faz."
   - "Altere apenas `README.md`: adicione uma seção 'Instalação' com os comandos `npm install` e `npm start`."
   - "Refatore a função X em `lib/utils.js` mantendo o comportamento. Não altere outros arquivos."
5. **Acompanhar e aprovar**: monitore as ferramentas chamadas. Quando houver solicitação de permissão, aprove/rejeite/sempre nos cartões exibidos no rodapé do terminal.
6. **Revisar alterações**: arquivos modificados aparecem no painel "Alterações" (Git) e na árvore. Abra as abas para revisar diffs. O `fs.watch` atualiza automaticamente a interface.
7. **Salvar/commitar**: se editar manualmente, use `Ctrl+S` ou botão "Salvar". Para commitar as alterações feitas pelo agente, use o painel Git ou o botão de commit na interface — isso fará `git add -A`, commit e push para o GitHub usando o token conectado.
8. **Interromper se necessário**: use o botão "Interromper" ou `Esc` para cancelar uma execução em andamento.

#### Dicas importantes
- **Escopo**: o agente trabalha no diretório do espelho (`location.directory`). Ferramentas de shell podem teoricamente acessar fora, mas o fluxo proposto é restrito ao repositório.
- **Arquivos dirty**: se houver abas modificadas não salvas no editor, salve-as antes de pedir grandes alterações ao agente para evitar confusões.
- **Sem provedor**: se o terminal ficar em "processando..." sem progresso ou com erros de provedor, verifique `opencode auth login` e se há créditos/modelo disponível.
- **Reinício da ponte**: se a ponte cair, o OpenCode pode ser reiniciado; sessões podem ser perdidas — basta reabrir o terminal para criar/recuperar conforme disponível.

### 13.3 Lacunas a fechar (ordem recomendada)

1. **Saúde do modelo antes do prompt.** 🔄 **Em andamento.** Estender `/api/opencode/status` para
   devolver o modelo selecionado e se há provedor utilizável; desabilitar a
   entrada com uma explicação clara quando não houver. Tratar
   `session.retry.scheduled` e mostrar `error.message` / status HTTP.
2. **Corrigir os nomes dos eventos.** ✅ **Feita.** Trocar `session.tool.error` por
   `session.tool.failed` e tratar `session.step.failed`,
   `session.execution.interrupted` e `session.reasoning.*` (§4.3). Sem isso,
   ferramenta que falha fica com “…” e o *busy* pode não ser liberado.
3. **Salvar o editor antes de enviar.** O agente lê o **disco**; abas *dirty*
   ainda não estão lá. Salvar as abas (ou bloquear com aviso) no `send()`.
   Depois de uma edição do agente, se a aba estiver *dirty*, avisar do conflito
   em vez de ignorar o `refreshFromDisk`.
4. **Anexar arquivos ao prompt.** O terminal nunca envia `files`. Na v2 cada
   anexo é `{ uri: "file:///caminho/absoluto", name?, description? }`; usar o
   arquivo/trecho selecionado como contexto reduz o risco de o agente varrer o
   repositório inteiro.
5. **Permissões em tempo real.** Hoje o frontend faz *polling* a cada 2 s.
   Passar a reagir aos eventos de permissão, guardar a escolha “Sempre” e
   mostrar o comando/caminho exato antes de aprovar. Para leitura, um conjunto
   de regras “allow read / ask write” no config do OpenCode reduz o atrito.
6. **Resiliência da sessão.** Testar matar o `opencode serve` durante uma
   execução: o `sessionFor` deve reencontrar a sessão em
   `GET /api/session?directory=…`; se não, recriar, recarregar o histórico e
   avisar “sessão reiniciada” em vez de perder o terminal (§12, item 9).
7. **Isolamento real (segurança).** `location.directory` define o diretório da
   sessão, mas não impede que uma ferramenta de shell alcance `../` ou o HOME.
   Para prometer “só este repositório”, rodar o `opencode serve` em
   container/usuário com apenas o espelho montado, ou aplicar regras de
   permissão que neguem caminhos fora dele. Documentar o que está garantido —
   hoje a afirmação “só enxerga o repositório” vale para as ferramentas de
   arquivo, não para o shell.
8. **Teste de ponta a ponta com OpenCode real.** Criar um teste (fora do
   `npm test`, atrás de `VSX_OPENCODE_E2E=1` porque exige provedor/rede) que
   sobe a ponte, abre um repo temporário, pede para ler um arquivo, depois
   alterá-lo, e confere: eventos de ferramenta, mudança no disco, `fs.changed`
   chegando ao navegador e commit. É o que falta para considerar o requisito
   validado, e não apenas “encanado”.
9. **Acabamento de Git.** Depois de cada execução, atualizar o status e abrir
   o diff automaticamente; tratar o caso de o agente criar arquivos que o
   `.gitignore` ignora; manter a mensagem de commit obrigatória e o erro de
   push visível (o commit local não pode parecer push bem-sucedido).

> Resumo: **para usar hoje**, basta configurar um provedor de modelo, subir a
> ponte e abrir o repositório — o agente já lê e altera o espelho. **Para
> confiar no recurso**, os itens 1–3 e 8 são os que mais importam; o 7 é o que
> transforma a promessa de isolamento em garantia.

---

## 14. Próximos passos — multiusuário com GitHub Codespaces

### 14.1 Decisão de arquitetura

O vsx deve atender **até 50 alunos simultâneos**, cada um no próprio
repositório, com o OpenCode completo, modelo configurado por cada aluno,
ambiente recriável a cada acesso e **custo zero** para o projeto. A única
arquitetura que atende a esses requisitos é **um workspace por aluno**, no
mesmo modelo do VS Code/Codespaces:

- o **GitHub Pages** continua sendo a interface única;
- o **GitHub Codespaces** é o backend de cada aluno;
- o **broker** continua sendo o ponto stateless de troca do OAuth;
- **não** existe uma ponte central compartilhada;
- **não** existe um pool de 50 containers mantido pelo projeto.

O requisito “qualquer visitante” passa a significar **qualquer visitante com
conta GitHub**, o que já é necessário para acessar o próprio repositório. Não
há compartilhamento de repositório, token, sessão ou terminal. Live Share e
edição simultânea do mesmo arquivo ficam fora desta fase.

### 14.2 Por que não usar um backend central gratuito

| Opção | Plano gratuito | 50 simultâneos | Decisão |
| --- | --- | --- | --- |
| **Cloudflare Pages** | Sim | Só interface estática | Usar para o frontend |
| **Cloudflare Workers** | Sim | Só o broker OAuth | Usar para o broker |
| **Cloudflare Containers** | **Não** (Workers Paid, US$ 5/mês) | Não cabe no incluído | Descartado |
| **Fly.io** | Não tem free tier | Pago | Só se houver orçamento |
| **GitHub Codespaces** | 120 core-horas/mês por conta pessoal | Sim, um Codespace por aluno | **Escolhido** |
| **Oracle Always Free** | Limitado e sujeito a disponibilidade | CPU insuficiente para 50 agentes | Não recomendado |

A documentação do Cloudflare Containers informa: **Free = N/A**; o Workers
Paid inclui 25 GiB-hora de memória, 375 vCPU-min e 200 GB-hora de disco. Uma
única aula de 2 horas com 50 usuários a 512 MB já consome 50 GiB-hora — o dobro
do incluído no mês. A instância `lite` (256 MB, 1/16 vCPU) também é fraca para
rodar OpenCode, `git` e Node com fluidez.

O Codespaces resolve o problema porque **distribui a computação**: cada aluno
usa a própria cota gratuita. Em uma máquina de 2 núcleos, 120 core-horas
equivalem a 60 horas por mês. Uma aula de 2 horas por semana consome cerca de
16 core-horas/mês; 10 horas por semana, cerca de 80. Cinquenta alunos nesse
ritmo usam 50 cotas independentes — não uma cota central do projeto.

### 14.3 Arquitetura alvo

```
┌───────────────────────────────────────────────────────────────┐
│ GitHub Pages — workbench do vsx                               │
│ https://x3x31.github.io/vsx/                                  │
│ repos · árvore · editor · git · terminal                      │
└───────────┬───────────────────────────────┬───────────────────┘
            │ OAuth (código → token)         │ HTTP + SSE (token)
            ▼                               ▼
   Cloudflare Worker                 Codespace do aluno
   broker stateless                   ├─ clone do repositório dele
   (já publicado)                     ├─ git + opencode serve
                                      ├─ chave do modelo dele
                                      └─ vsx bridge isolada

            GitHub API  ←── login, repositórios, criação do Codespace
```

Princípios:

1. **Um Codespace por aluno**, criado a partir de um repositório-template com
   o devcontainer do vsx. O repositório editado é clonado dentro dele.
2. **Um token por workspace.** O token do GitHub vive apenas no Codespace
   daquele aluno (ou no navegador dele, no modo remoto); nunca no host do
   projeto.
3. **Uma chave de modelo por aluno**, configurada no Codespace (de
   preferência como *secret* do Codespaces) ou informada na interface e
   mantida apenas naquele navegador/workspace.
4. **Sem estado central.** Sessões, histórico, arquivos e credenciais não
   persistem no servidor do vsx.
5. **Sem compartilhamento.** Cada aluno vê apenas o próprio clone; o commit vai
   para o próprio repositório/branch.
6. **A ponte atual continua sendo o workspace agent.** Não é necessário
   refatorar `server/` para multi-tenant: cada Codespace roda uma instância
   privada dela.

### 14.4 Mudanças por componente

| Componente | Situação atual | Mudança necessária |
| --- | --- | --- |
| `index.html` / `js/*` | Interface estática no Pages | Nenhuma mudança estrutural; adicionar o provedor “Codespaces” e o assistente de conexão |
| `js/bridge.js` | Descobre a ponte local e o Codespace por uma URL fixa | Descobrir a URL do Codespace do aluno, validar saúde e usar token de sessão; nunca depender de `127.0.0.1` a partir do Pages |
| `js/workspace.js` / `js/main.js` | Escolhe entre modo direto e ponte | Adicionar o modo `codespace`, persistir o Codespace escolhido e tratar workspace parado/expirado |
| `js/terminal.js` | Fala com a ponte por SSE | Nenhuma mudança de contrato; herda o isolamento do Codespace |
| `server/index.js` | **Feito (parte 2)**: escuta em `0.0.0.0` quando detecta Codespace, imprime a URL pública correta, exige token e restringe o CORS | Nada nesta etapa; o `/api/bridge/info` ganhou `publicUrl`, `codespace`, `host` e `port` |
| `server/config.js` | **Feito (parte 2)**: reconhece `CODESPACES`, `CODESPACE_NAME` e `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`; `publicUrlFor()` centraliza a URL (`VSX_PUBLIC_URL` tem prioridade) | Nada nesta etapa |
| `server/opencode.js` | Um `opencode serve` por ponte | Mantém: cada Codespace tem o seu; conferir versão ≥ 2.1.3 no devcontainer |
| `broker/worker.js` | Troca OAuth stateless | Mantém; opcionalmente ganha uma rota para criar/retomar Codespace via API do GitHub |
| `.devcontainer/` | **Feito (parte 1)**: Dockerfile, `devcontainer.json`, `setup.sh` e `start.sh`; a ponte sobe na porta 4173 | Nada nesta etapa |
| Template do Codespace | Não existe | **Novo** repositório-template com o devcontainer, `README` do aluno e botão “Open in Codespaces” |
| Documentação | README atual | Guia do aluno: login, cota, criar/retomar/apagar workspace, configurar modelo (via `opencode auth login` ou *Codespaces Secrets*), commit e fallback local |

### 14.5 Fluxo do aluno

#### Primeira versão (manual, para validar)

1. O aluno abre `https://x3x31.github.io/vsx/` e conecta a conta GitHub.
2. A partir do repositório-template, clica em **“Open in Codespaces”** para criar
   seu próprio Codespace (um por aluno, totalmente isolado).
3. Aguarda a inicialização: o devcontainer instala o `@opencode/cli` (na imagem),
   executa `postCreateCommand`/`postStartCommand` e a ponte do vsx sobe em
   background na porta 4173 com um token aleatório.
4. No terminal integrado do Codespace, **autenticar o provedor do OpenCode uma
   única vez**: `opencode auth login` (seguindo o fluxo OAuth no navegador) ou,
   se preferir, configurar via *Codespaces Secrets* (`ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, etc.) antes de abrir o workspace.
5. Copiar a URL HTTPS encaminhada da porta 4173 ou conectar pelo modal
   **“Conectar workspace no Codespaces”** no vsx (informando URL + token da ponte).
6. O Pages passa a falar com a ponte daquele Codespace; o terminal, a árvore e
   o Git funcionam como no modo local. Cada aluno vê apenas seu próprio
   repositório, sessão e credenciais.
7. Ao terminar, o aluno pode parar ou apagar o Codespace para economizar sua
   cota; o token local é limpo.

A primeira inicialização leva cerca de 1–3 minutos; as seguintes são mais
rápidas enquanto o Codespace existir. **Com o devcontainer já pronto, não é
necessário instalar o OpenCode manualmente — apenas autenticar o provedor uma
única vez no ambiente do próprio Codespace.**

#### Versão automatizada (depois do MVP)

1. O vsx usa a API do GitHub para criar ou retomar um Codespace a partir do
   template.
2. O frontend acompanha o estado (`provisioning` → `available`), obtém a URL
   da porta e o token de conexão.
3. Se a API exigir escopo adicional (`codespace`), o OAuth App é ajustado; se
   não for possível, o botão oficial “Open in Codespaces” continua sendo o
   fallback.
4. O botão “Encerrar” chama a API para parar/apagar o Codespace, conforme a
   escolha do aluno.

### 14.6 Segurança e isolamento

- **Token da ponte obrigatório** em todas as rotas de API, inclusive SSE. A
  porta pública do Codespace não pode ficar aberta sem autenticação. A ponte
  aceita `Authorization: Bearer <token>`, `x-vsx-secret` (interface atual) ou
  `x-vsx-bridge-token`; no EventSource, que não envia cabeçalhos, o token vai
  em `?secret=` por enquanto.
- **CORS restrito** a `https://x3x31.github.io` e à própria origem pública do
  Codespace (`publicUrl`); qualquer outra origem não recebe
  `access-control-allow-origin`.
- **Nenhum token do GitHub no host do projeto.** O token de clone/push fica no
  Codespace do aluno; o modelo fica na chave dele.
- **Porta pública com token**, ou porta privada se o `fetch` autenticado do
  Pages funcionar de forma confiável. O token nunca vai na URL; usar
  `Authorization`/`x-vsx-token` e uma janela curta de validade.
- **Um Codespace por pessoa** já fornece isolamento de container. A ressalva do
  §13.3 item 7 (`location.directory` não é jaula para o shell) deixa de
  alcançar outros alunos, mas ainda vale dentro do próprio workspace.
- **Limpeza:** parar/apagar o Codespace remove o clone, o token e a chave do
  modelo; o vsx não deve guardar nada disso no servidor.
- **Escopo mínimo do GitHub:** `repo` para os repositórios; avaliar `codespace`
  apenas se a criação automática for adotada.
- **Repositórios pessoais:** a cota gratuita do Codespaces é de contas
  pessoais; repositórios de organização podem ser cobrados da organização.

### 14.7 Cota, ciclo de vida e custo

| Item | Valor |
| --- | --- |
| Cota gratuita por conta pessoal | 120 core-horas/mês e 15 GB-mês de armazenamento |
| Máquina de 2 núcleos | 60 horas/mês |
| Aula de 2 h/semana | ~16 core-horas/mês por aluno |
| 10 h/semana | ~80 core-horas/mês por aluno |
| Custo para o projeto | Zero (cada aluno usa a própria cota) |
| Persistência | Nenhuma além do Codespace; apagar ao final |

O armazenamento conta enquanto o Codespace existe, mesmo parado. Por isso o
fluxo deve incentivar **apagar** ao final da aula, e não apenas parar. O
Codespaces também tem timeout de inatividade; a ponte precisa lidar com
`stopped`/`shutdown` e oferecer “retomar” ou “criar novo”.

### 14.8 Ordem de implementação

1. **Empacotar o workspace.** ✅ **Feito (parte 1).** `.devcontainer/` com
   Dockerfile, `devcontainer.json`, `setup.sh` e `start.sh`; o script
   `npm run start:codespace` sobe a ponte em `0.0.0.0:4173`, gera o token e
   imprime a URL pública.
2. **Adaptar a ponte ao Codespaces.** ✅ **Feito (parte 2).** A ponte detecta
   `CODESPACES`, `CODESPACE_NAME` e
   `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` (via `server/config.js`), escuta
   em `0.0.0.0`, calcula a URL `https://<CODESPACE_NAME>-<porta>.<domínio>`,
   exige token em todas as rotas de API, restringe o CORS ao Pages e à origem
   pública e expõe `GET /api/bridge/info` com `publicUrl`, `version`,
   `codespace`, `host` e `port`. Coberto por `test/codespace.test.mjs`
   (`npm test`), que exercita a conexão com `Origin: https://x3x31.github.io`.
3. **Adicionar o provedor no frontend.** ✅ **Feito (parte 3 + parte 3.1).** `Workspace`
   ganha o modo `codespace`, `js/bridge.js` passa a verificar URLs de
   workspace (`verifyAt`), `js/api.js` persiste o Codespace em
   `localStorage` (`vsx.codespace`), o topo ganha o indicador `codespace: …`
   e um modal “Conectar workspace no Codespaces” (URL + token). Na janela de
   conexão do GitHub há o atalho “Usar um workspace no Codespaces”. Ao
   recarregar, o frontend redescobre o workspace salvo (detectando
   parado/expirado ou token recusado) e abre a janela de reconexão com os
   campos preenchidos; se a ponte do Codespace já tiver a conta conectada, o
   app entra direto. O fluxo funciona no GitHub Pages com CORS restrito pelo
   servidor. Coberto por `test/codespace_pages.test.mjs`.
4. **Criar o template e o fluxo manual.** Publicar o repositório-template com
   o `.devcontainer/` (opencode pré-instalado), documentar o botão “Open in
   Codespaces”, adicionar guia do aluno para autenticação do provedor
   (`opencode auth login` ou *Codespaces Secrets*) e testar o ciclo completo
   com dois alunos e dois repositórios diferentes.
5. **Automatizar a criação/retomada.** Avaliar a API de Codespaces, o escopo
   OAuth necessário, polling de estado, obtenção da URL e encerramento. Manter
   o fluxo manual como fallback.
6. **Testar isolamento e concorrência.** Dois navegadores, duas contas, ao
   mesmo tempo: cada um deve ver apenas o próprio repositório, token, terminal
   e commits. Testar reconnect após parada, troca de modelo, commit/push e
   limpeza.
7. **Piloto e rollout.** Validar com 5 alunos, depois 20, depois 50. Medir
   tempo de inicialização, falhas de cota, qualidade da rede e suporte.
   Publicar o guia do aluno e o fallback local em Docker para quem não puder
   usar Codespaces.

### 14.9 Critérios de aceite

- [ ] O aluno entra no Pages, autentica no GitHub e chega ao próprio workspace
      sem configurar ponte manualmente no fluxo principal.
- [ ] Dois alunos simultâneos não veem repositório, arquivos, terminal ou
      token um do outro.
- [ ] O OpenCode lê e altera arquivos do repositório do aluno e o commit chega
      ao GitHub.
- [ ] Cada aluno configura o próprio modelo (via `opencode auth login` ou
      *Codespaces Secrets*); não há chave compartilhada.
- [ ] O binário do OpenCode já vem pré-instalado no devcontainer (não exige
      `npm install -g` pelo aluno).
- [ ] Workspace parado pode ser retomado; workspace apagado pode ser recriado
      do zero.
- [ ] A cota gratuita de cada aluno é suficiente para o ritmo da disciplina.
- [ ] O projeto não mantém backend central de computação nem credenciais de
      alunos.
- [ ] `npm test` e `npm run test:e2e` continuam passando; o teste com OpenCode
      real segue a regra do §13.3 item 8.

### 14.10 Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Cota do Codespaces esgotada | Orientar 2 núcleos, apagar ao final, monitorar consumo; fallback local |
| Codespaces indisponível na rede/escola | Fallback com Docker local e túnel HTTPS; documentar |
| Primeira inicialização lenta | Template pequeno, imagem enxuta, cache do devcontainer; avisar 1–3 min |
| Porta pública exposta | Token obrigatório, CORS restrito, validade curta, nunca token na URL |
| API de criação exigir escopo extra | Fluxo manual “Open in Codespaces” como fallback |
| Provedor de modelo falhar (503/`retry`) | Saúde do modelo antes do prompt (§13.3 item 1); cada aluno usa a própria chave |
| Repositório de organização cobrar a cota | Usar repositórios pessoais ou template pessoal |
| Aluno sem conta GitHub | Fluxo local/Docker ou criação de conta; não há como acessar repo sem autenticação |

### 14.11 Fora de escopo nesta fase

- Live Share, cursores compartilhados e edição do mesmo arquivo em tempo real.
- Um backend central gratuito com 50 containers.
- Persistência de sessões, históricos ou arquivos no servidor do projeto.
- Marketplace de extensões, depurador e LSP completo.
- Substituir o GitHub Codespaces por outro provedor sem orçamento.

> Resumo: **o vsx deixa de tentar ser um servidor único e passa a ser um
> workbench que se conecta ao Codespace de cada aluno.** Essa é a versão
> realista do modelo do VS Code para 50 usuários simultâneos com orçamento
> zero.

---

## 15. Glossário

| Termo | Significado |
| --- | --- |
| **ponte** | o servidor Node do vsx (espelho git + OpenCode + troca OAuth) |
| **broker** | worker stateless que só troca o `code` da autorização por token — é o que faz o OAuth funcionar no Pages (`broker/worker.js`) |
| **espelho** | clone local do repositório em `~/.local/share/vsx/workspaces` |
| **modo direto** | o app fala com `api.github.com` sem servidor |
| **modo ponte** | o app fala com a ponte, que fala com o GitHub |
| **Codespace** | container Linux remoto e isolado, um por aluno, usado como backend do vsx (§14) |
| **workspace agent** | a ponte rodando dentro do Codespace do aluno |
| **workbench** | a interface estática do vsx publicada no GitHub Pages |
| **template** | repositório com o devcontainer usado para criar o Codespace de cada aluno |
| **endereço de retorno** | a `redirect_uri` do OAuth: onde o GitHub devolve a autorização |
| **PKCE** | extensão do OAuth que dispensa `client_secret` |
| **gate** | a tela de autenticação do Codespace nas portas públicas |
