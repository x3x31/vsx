# vsx — especificação e arquitetura

> Documento de referência e de continuidade. Descreve o que o vsx é, como ele é
> estruturado, as restrições do navegador que moldaram o desenho, e o que ainda
> está em aberto.
>
> Última atualização: depois do commit `4f455f2` (fluxo OAuth web com PKCE,
> endereço de retorno editável, descoberta automática da ponte).

---

## 1. O que é

O **vsx** é uma aplicação web (HTML + CSS + JavaScript puro, sem framework e sem
build) que funciona como editor de repositórios do GitHub com um terminal do
**OpenCode** acoplado. Publicada no GitHub Pages em:

**<https://x3x31.github.io/vsx/>**

A interface tem quatro áreas:

| Área | Função |
| --- | --- |
| Menu lateral esquerdo | Lista de repositórios do GitHub (só os com permissão de escrita), com busca |
| Painel de arquivos | Árvore do repositório + painel de alterações do Git |
| Editor | CodeMirror 5, abas, realce de sintaxe, `Ctrl+S` |
| Terminal (parte inferior) | Sessão do OpenCode **restrita ao repositório selecionado** |

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
css/app.css         tema escuro (~1.200 linhas)
js/                 aplicação do navegador (módulos ES nativos, sem bundler)
  api.js            token, github, bridge e workspace — a composição central
  github.js         cliente da API do GitHub rodando no navegador
  bridge.js         cliente da ponte local (descoberta, segredos, SSE)
  workspace.js      camada que escolhe entre os dois modos
  repos.js          menu de repositórios
  tree.js           árvore de arquivos
  editor.js         CodeMirror: abas, dirty, salvar
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
vendor/codemirror/  CodeMirror 5 empacotado (funciona offline)
```

---

## 4. O frontend

### 4.1 `js/workspace.js` — a camada que escolhe o modo

Interface implementada por duas classes (`BridgeProvider` implícito no
`Workspace`, e as chamadas diretas):

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
- Eventos relevantes: `session.text.delta` / `.ended`, `session.tool.input.*`,
  `session.tool.called`, `session.tool.success`, `session.tool.error`,
  `session.execution.*`, `session.usage.updated`.
- Sem ponte: mostra o motivo e desabilita a entrada.

### 4.4 `js/editor.js` — abas e dirty

Cada aba guarda `{path, content, dirty, scroll}`. O dirty é controlado por um
flag `suppressChange`, para que gravar o valor programaticamente não marque a
aba como alterada.

---

## 5. A ponte (servidor Node)

Rode com `npm start` (porta 4173). Sem dependências externas: só Node ≥ 20,
`git` no PATH e `opencode` instalado.

### 5.1 Rotas

| Rota | Descrição |
| --- | --- |
| `GET /api/bridge/info` | Identifica a ponte (usado na detecção) |
| `GET /oauth/callback` | **Volta da autorização do GitHub**: troca o código por um token e redireciona para o vsx |
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

### 5.2 O OpenCode

`server/opencode.js` sobe um `opencode serve` dedicado (porta livre, senha lida
da saída do processo, usada como Basic auth) e cria as sessões com:

```js
await opencode.sessionFor(diretórioDoEspelho)   // location.directory = espelho
```

É isso que garante o requisito central: **o agente só enxerga e só escreve nos
arquivos do repositório selecionado**.

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

> A checagem é feita por `fetch` e **não** é confiável para decidir se a
> autorização vai funcionar: o `fetch` é bloqueado em casos em que a
> *navegação* funciona. Por isso o botão **Conectar com GitHub** não bloqueia
> por causa dela.

---

## 7. O fluxo OAuth

### 7.1 Web flow com PKCE (o que está em uso)

```
clique em "Conectar com GitHub"
  │
  ├─ vsx gera um code_verifier e o code_challenge (S256)
  ├─ abre o GitHub numa janela:
  │    https://github.com/login/oauth/authorize
  │      ?client_id=…&redirect_uri=<ponte>/oauth/callback
  │      &scope=repo&state=<base64url({v,r,c,u})>
  │      &code_challenge=…&code_challenge_method=S256
  │
  ├─ o usuário autoriza (ou faz login) no GitHub
  │
  ├─ o GitHub redireciona para <ponte>/oauth/callback?code=…&state=…
  │      ↳ navegação: funciona mesmo do GitHub Pages para uma ponte em loopback
  │
  ├─ a ponte troca o código por um token
  │      POST https://github.com/login/oauth/access_token
  │        {client_id, code, redirect_uri, code_verifier}   ← sem client_secret
  │
  └─ a ponte redireciona de volta:
        <vsx>/#vsx_token=…&vsx_login=…
        a janela lê o hash, envia por postMessage e fecha
```

O `state` carrega `{v: verifier, r: returnTo, c: clientId, u: redirectUri}` em
base64url — o `verifier` viaja assim para a ponte, que o usa na troca. **Não
existe `client_secret` em lugar nenhum.**

### 7.2 Device flow (alternativa, ainda na ponte)

`POST /api/oauth/device/start` → código de 8 caracteres → o usuário digita em
`github.com/login/device` (a página aceita `?user_code=` para pré-preencher) →
`POST /api/oauth/device/poll` entrega o token. Exige que a ponte responda por
`fetch`, então só funciona se ela for alcançável assim.

### 7.3 Token de acesso pessoal (terceira via)

Campo na janela de conexão. Um PAT com escopo `repo`. Funciona sem ponte
qualquer — é a saída para quem não quer rodar nada.

---

## 8. Configuração da ponte

Arquivo `~/.config/vsx/config.json` (permissão `600`):

```json
{
  "token": "ghp_…",
  "user": { "login": "x3x31", "name": "…", "avatar": "…", "email": null },
  "disabled": false,
  "clientId": "Ov23liY3KVcMBqRaEwBi",
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
| `bridgeSecret` | Senha da ponte, gerada uma vez e mantida entre reinícios |
| `lastRepo` / `lastBranch` | Último repositório aberto (reabrir é manual) |

Variáveis de ambiente:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4173` | Porta da ponte |
| `HOST` | `127.0.0.1` | Interface — use `0.0.0.0` para expor (exige senha) |
| `BRIDGE_SECRET` | gerada e guardada no config | Senha da ponte exposta |
| `GITHUB_TOKEN` | — | PAT usado quando nenhum token é digitado |
| `GITHUB_OAUTH_CLIENT_ID` | — | Client ID do OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | Só se o OAuth App não usar PKCE |
| `CORS_ORIGINS` | ver abaixo | Origens autorizadas a chamar a ponte |

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
| Senha obrigatória quando a ponte escuta fora do loopback | Quem está na rede poderia rodar o OpenCode na máquina |
| `timingSafeEqual` na comparação da senha | Evita comparação por tempo |
| Lista de origens no CORS | Só o GitHub Pages e o localhost falam com a ponte |
| `Access-Control-Allow-Private-Network` no preflight | Necessário para alcançar a ponte em rede privada |
| Token do GitHub no `localStorage` do navegador | Inerente ao modo direto; o token fica só na máquina do usuário |
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
```

Os testes usados no desenvolvimento ficam em `/tmp/opencode` (fora do
repositório) e são Playwright:

| Arquivo | O que cobre |
| --- | --- |
| `smoke.mjs` | fluxo completo no modo ponte: conectar, abrir repo, editar, salvar, commitar, terminal, branch |
| `test_agent.mjs` | o OpenCode cria um arquivo e a interface reflete (árvore, editor, git) |
| `test_branch.mjs` | troca de branch e criação de arquivo pela interface |
| `test_direct.mjs` | modo direto: sem ponte, tudo contra a API do GitHub, com commit real |
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

1. **A conexão OAuth ainda não foi concluída ponta a ponta por um humano.** O
   fluxo foi validado com GitHub simulado e contra o GitHub real até a tela de
   autorização (parâmetros conferidos: `client_id`, `redirect_uri`, PKCE
   `S256`, `state` decodificável). O passo final — o clique em *Authorize* e a
   volta com o token — exige uma sessão web do GitHub no navegador, que não
   existe no ambiente automatizado.
2. **O `redirect_uri` precisa ser alcançável pelo navegador de quem usa.** Se
   o navegador estiver no laptop e a ponte no Codespace, `127.0.0.1` não
   resolve. As saídas:
   - rodar a ponte na máquina do navegador (o callback `http://127.0.0.1:4173/oauth/callback`
     já está cadastrado no OAuth App);
   - expor a porta do Codespace como **Public** (senão o *gate* descarta o
     `?code=`) e usar `https://4173-app.github.dev/oauth/callback` — lembrando
     que o GitHub aceita **um** callback URL por OAuth App.
3. **O `vsx` não tem testes no repositório.** Os testes vivem em `/tmp`. Vale
   movê-los para `test/` e rodá-los com `npm test`.
4. **Falta um `package.json` com `npm test`** e, se possível, um
   `playwright.config.js`.
5. **O device flow continua no código** mas o app não o usa mais — pode ser
   removido junto com as rotas `/api/oauth/device/*`.
6. **A busca de commits e o histórico de branches da API do GitHub** estão
   expostos no backend mas não usados na interface.

---

## 13. Glossário

| Termo | Significado |
| --- | --- |
| **ponte** | o servidor Node do vsx (espelho git + OpenCode + troca OAuth) |
| **espelho** | clone local do repositório em `~/.local/share/vsx/workspaces` |
| **modo direto** | o app fala com `api.github.com` sem servidor |
| **modo ponte** | o app fala com a ponte, que fala com o GitHub |
| **endereço de retorno** | a `redirect_uri` do OAuth: onde o GitHub devolve a autorização |
| **PKCE** | extensão do OAuth que dispensa `client_secret` |
| **gate** | a tela de autenticação do Codespace nas portas públicas |
