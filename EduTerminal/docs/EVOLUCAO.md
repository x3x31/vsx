# Evolução do VSX + EduTerminal

**Versão do documento:** 0.2  
**Última atualização:** 30/10/2026  
**Especificação de referência:** VSX + EduTerminal v1.1  
**Estado geral:** connector, cliente VSX, servir o VSX em `/vsx/` e scripts Termux concluídos; app Android e workflow de APK em finalização.

---

## 1. Objetivo central

Permitir que o **VSX hospedado no GitHub Pages** se conecte, por Wi-Fi local, ao **EduTerminal** (APK baseado no Termux), autentique a conexão por pareamento e use o **OpenCode rodando dentro do EduTerminal** para **ler, criar e alterar arquivos** no dispositivo Android, com o resultado aparecendo em tempo real no VSX.

Fluxo-alvo:

```text
VSX (GitHub Pages)
   │  pareamento + token
   ▼
Connector do EduTerminal (WebSocket + HTTP)
   │
   ├── workspace: listar, ler, gravar, diff, commit
   ├── terminal: sessões Bash (xterm/WebSocket)
   └── OpenCode local (serve) → ferramentas → arquivos do projeto
```

O VSX poderá alterar arquivos por dois caminhos complementares:

1. **Determinístico:** `/api/workspace/file` (ler/gravar), `/api/workspace/files`, `/api/workspace/diff`, `/api/workspace/commit`.
2. **Via OpenCode:** `/api/opencode/prompt` envia uma instrução em linguagem natural; o OpenCode executa as ferramentas e edita os arquivos; o VSX acompanha por `/api/stream` e relê o workspace.

---

## 2. Legenda

| Símbolo | Significado |
|---|---|
| ✅ | Implementado e coberto por teste |
| 🟡 | Em implementação nesta etapa |
| ⬜ | Pendente |
| ⛔ | Bloqueado por ambiente ou dependência externa |
| 🔍 | Precisa de validação em dispositivo real |

---

## 3. Mapa da especificação v1.1

| Seção da especificação | Estado | Observação |
|---|---|---|
| §1 Visão geral | ✅/🟡 | Arquitetura definida e materializada; falta validação ponta a ponta |
| §2 Arquitetura oficial | 🟡 | Connector, cliente VSX e scripts prontos; APK em finalização |
| §2.1 VSX — PWA | 🟡 | VSX existe e já tem cliente EduTerminal; ainda sem `manifest.json`, Service Worker e xterm.js |
| §2.2 EduTerminal — Android | 🟡 | Scaffold Gradle, manifest, layout e classes Java escritos; falta compilar |
| §2.3 Ambiente Linux | ✅/🔍 | Instalador Termux e bootstrap criados; validar em dispositivo |
| §3 Fluxo oficial | 🟡 | Passos 5–13 funcionam via API e VSX; app Android precisa ser compilado/testado |
| §4 Decisões de arquitetura | ✅ | Connector segue as decisões; APK é app companheiro do Termux nesta fase |
| §5 RF01 Inicialização | 🟡 | Scripts e serviço Android escritos; falta validar no dispositivo |
| §5 RF02 Terminal | ✅/🟡 | Servidor WebSocket e sessões Bash prontos; xterm.js no VSX pendente |
| §5 RF03 Ferramentas | ✅/🟡 | Listagem/instalação via `pkg` e UI Android escritas; validar no dispositivo |
| §5 RF04 Servidor local | ✅ | HTTP + WebSocket, autenticação, sessões e limites |
| §5 RF05 Pareamento | ✅ | Código de 6 dígitos, aprovação explícita, token com validade |
| §5 RF06 Sessões | ✅/🟡 | Criar, listar, encerrar e WebSocket; reconexão pendente |
| §5 RF07 OpenCode | ✅/🔍 | Proxy e ciclo de vida implementados; validar ARM64/Termux |
| §6 Comunicação | ✅/🟡 | Protocolo WebSocket pronto; reconexão e WSS pendentes |
| §7 Segurança | ✅/🟡 | Token, expiração, aprovação, limite e path traversal; HTTPS/WSS pendente |
| §8 Interface do VSX | ✅/🟡 | Chip, modal, pareamento e conexão integrados; terminal xterm pendente |
| §9 Interface do EduTerminal | 🟡 | Tela Android escrita; falta compilar e validar |
| §10 Requisitos não funcionais | 🟡 | Depende de compilação e validação em Android real |
| §11 Estrutura dos repositórios | ✅/🟡 | Estrutura adaptada ao repositório real |
| §12 Distribuição | 🟡 | Workflow de APK criado; download, versão e histórico pendentes |
| §13 Etapas de desenvolvimento | ✅/🟡 | Etapas 1–5 adiantadas; falta aceitação em dispositivo |
| §14 Critérios de aceitação | 🟡 | Componentes internos passam; aceitação ponta a ponta ainda não |
| §15 Princípios | ✅ | Projetos separados, interface documentada, execução local |
| §16 Visão final | 🟡 | Fundação pronta; falta experiência completa no dispositivo |

---

## 4. O que já foi implementado

### 4.1 Estrutura criada

```text
EduTerminal/
├── connector/
│   ├── bin/eduterminal.mjs
│   ├── public/index.html
│   ├── src/
│   │   ├── config.mjs
│   │   ├── github.mjs
│   │   ├── opencode.mjs
│   │   ├── pairing.mjs
│   │   ├── server.mjs
│   │   ├── sessions.mjs
│   │   ├── tools.mjs
│   │   ├── util.mjs
│   │   ├── workspace.mjs
│   │   └── ws.mjs
│   ├── test/
│   │   ├── connector.test.mjs
│   │   ├── helpers.mjs
│   │   ├── pairing.test.mjs
│   │   ├── vsx-client.test.mjs
│   │   └── ws.test.mjs
│   └── package.json
├── android-app/
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/org/eduterminal/app/
│   │   │   ├── ConnectorClient.java
│   │   │   ├── EduTerminalService.java
│   │   │   ├── MainActivity.java
│   │   │   ├── NetworkUtils.java
│   │   │   └── TermuxBridge.java
│   │   └── res/
│   ├── build.gradle
│   └── settings.gradle
├── bootstrap/
│   ├── start.sh
│   ├── status.sh
│   └── stop.sh
├── installer/
│   └── termux-install.sh
└── docs/
    └── EVOLUCAO.md

.github/workflows/
├── eduterminal-apk.yml
└── eduterminal-connector.yml

js/
└── eduterminal.js
```

### 4.2 Connector (Node.js, sem dependências obrigatórias)

- Servidor HTTP compatível com a API da ponte do VSX.
- Servidor WebSocket próprio, sem biblioteca externa, em `/ws`.
- SSE em `/api/stream` para eventos do OpenCode e do workspace.
- CORS com allowlist de origens (`github.io`, `localhost`, `127.0.0.1`).
- TLS opcional via `EDUTERMINAL_TLS_KEY` e `EDUTERMINAL_TLS_CERT`.
- Limite de corpo de requisição e de sessões simultâneas.
- `node-pty` é opcional; sem ele, as sessões usam pipes (sem TTY real).

### 4.3 Pareamento e segurança

- Código temporário de 6 dígitos, com TTL configurável (padrão 120 s).
- Pedido de pareamento criado pelo VSX com o código.
- Aprovação **explícita** no dispositivo (ou `--auto-approve` apenas em desenvolvimento/testes).
- Token de acesso com validade padrão de 8 h.
- Revogação de tokens.
- Toda a API (exceto saúde e pareamento) exige token.
- Rotas administrativas exigem token de admin ou acesso local.
- Proteção contra path traversal no workspace.
- Sessões WebSocket exigem autenticação em até 10 s.

### 4.4 API HTTP implementada

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Saúde do connector |
| GET | `/api/bridge/info` | Identidade compatível com a ponte do VSX |
| GET | `/api/state` | Estado geral |
| POST | `/api/eduterminal/pair/request` | VSX solicita pareamento com código |
| GET | `/api/eduterminal/pair/status` | VSX consulta aprovação |
| POST | `/api/eduterminal/pairing/start` | Gera código (admin/local) |
| GET | `/api/eduterminal/pairing/current` | Código atual (admin/local) |
| GET | `/api/eduterminal/requests` | Pedidos pendentes (admin/local) |
| POST | `/api/eduterminal/pair/approve` | Aprova pedido (admin/local) |
| POST | `/api/eduterminal/pair/deny` | Recusa pedido (admin/local) |
| GET | `/api/eduterminal/tokens` | Lista tokens (admin/local) |
| DELETE | `/api/eduterminal/tokens` | Revoga token (admin/local) |
| GET | `/api/eduterminal/status` | Versão, uptime, workspace, sessões |
| GET/POST/DELETE | `/api/eduterminal/sessions` | Lista, cria e encerra sessões |
| GET | `/api/eduterminal/tools` | Ferramentas e estado de instalação |
| POST | `/api/eduterminal/tools/install` | Instala ferramenta via `pkg` |
| POST | `/api/workspace/open` | Abre pasta/repositório local |
| GET | `/api/workspace/files` | Lista arquivos |
| GET/PUT/DELETE | `/api/workspace/file` | Lê, grava e apaga arquivo |
| POST | `/api/workspace/new` | Cria arquivo/pasta |
| GET | `/api/workspace/status` | Estado do Git |
| GET | `/api/workspace/diff` | Diff do workspace |
| POST | `/api/workspace/commit` | Commit |
| POST | `/api/workspace/discard` | Descarta alterações |
| GET | `/api/github/repos` | Repositórios do usuário |
| GET | `/api/github/branches` | Branches de um repositório |
| GET | `/api/opencode/status` | Estado do OpenCode local |
| GET/POST | `/api/opencode/session` | Sessão atual/nova |
| POST | `/api/opencode/prompt` | Envia instrução ao OpenCode |
| POST | `/api/opencode/interrupt` | Interrompe execução |
| GET/POST | `/api/opencode/permission` | Permissões do OpenCode |
| POST | `/api/opencode/model` | Troca modelo |
| POST | `/api/opencode/agent` | Troca agente |
| GET | `/api/opencode/messages` | Mensagens da sessão |
| GET | `/api/stream` | SSE de eventos |

### 4.5 Protocolo WebSocket implementado

Mensagens do cliente:

| Tipo | Campos | Função |
|---|---|---|
| `auth` | `token` | Autentica a conexão |
| `ping` | `t` | Mantém a conexão viva |
| `session.list` | — | Lista sessões |
| `session.create` | `name`, `shell`, `args`, `cwd`, `cols`, `rows` | Cria sessão |
| `session.input` | `sessionId`, `data` | Envia entrada |
| `session.resize` | `sessionId`, `cols`, `rows` | Redimensiona |
| `session.close` | `sessionId` | Encerra sessão |

Mensagens do servidor:

| Tipo | Função |
|---|---|
| `hello` | Identifica o EduTerminal e exige autenticação |
| `auth.ok` / `auth.error` / `auth.required` | Resultado da autenticação |
| `pong` | Resposta ao ping |
| `session.list` | Lista de sessões |
| `session.created` | Sessão criada |
| `session.output` | Saída do terminal |
| `session.exit` | Sessão encerrada |
| `error` | Erro de protocolo |

### 4.6 Interface local do connector

- Página em `http://<ip>:8765/` com:
  - saúde do servidor;
  - código de pareamento;
  - pedidos pendentes com aprovar/recusar;
  - tokens ativos com revogação;
  - estado do OpenCode e do workspace.

### 4.7 Testes

Executados em 30/10/2026:

```text
19 testes
19 passando
0 falhando
```

Cobrem:

- pareamento por código;
- exigência de aprovação explícita;
- código errado, usado ou expirado;
- revogação de token;
- autenticação e mensagens WebSocket;
- entrada/saída e encerramento de sessão;
- abertura de workspace, leitura/gravação e path traversal;
- listagem de ferramentas;
- proxy do OpenCode com servidor falso;
- exigência de token do GitHub;
- saúde e página inicial públicas;
- cliente `js/eduterminal.js` (normalização, pareamento e cabeçalhos);
- VSX servido na mesma origem em `/vsx/`.

### 4.8 Cliente do VSX (concluído)

- `js/eduterminal.js` com:
  - normalização de URL;
  - persistência em `localStorage`;
  - pedido e consulta de pareamento;
  - espera pela aprovação;
  - verificação de token em `/api/bridge/info`;
  - listagem de ferramentas e sessões;
  - abertura de terminal via WebSocket.
- Integrado ao `index.html`, `js/main.js` e `css/app.css`:
  - chip `#btn-eduterminal` com estado da conexão;
  - modal `#modal-eduterminal` para URL, código, nome e desconexão;
  - `detectBridge()` prioriza o EduTerminal;
  - boot detecta conexão salva e, em `/vsx/`, usa a origem local.

### 4.9 VSX servido pelo connector

- `GET /vsx/` serve o próprio VSX a partir da raiz do repositório.
- `GET /vsx` redireciona para `/vsx/`.
- Allowlist de arquivos/pastas: `index.html`, `manifest.json`, `service-worker.js`, `css/`, `js/`, `vendor/`, `assets/`.
- O `index.html` é injetado com `window.__EDUTERMINAL_LOCAL__ = true` e `window.__EDUTERMINAL_URL__`.
- Objetivo: evitar mixed content e Private Network Access entre GitHub Pages (HTTPS) e o connector local (HTTP).

### 4.10 Scripts Termux

- `installer/termux-install.sh`:
  - instala Node.js, Git, Python, Nano e Vim;
  - habilita `allow-external-apps`;
  - clona/atualiza o repositório em `~/vsx`;
  - instala dependências do connector e tenta instalar o OpenCode.
- `bootstrap/start.sh`:
  - inicia o connector em segundo plano;
  - grava PID e log;
  - adquire wake-lock.
- `bootstrap/stop.sh`: encerra o connector e libera o wake-lock.
- `bootstrap/status.sh`: consulta `/health` e o código de pareamento atual.

### 4.11 App Android (em finalização)

- Pacote `org.eduterminal.app`, `minSdk 30`, `targetSdk 35`, Java 17.
- App companheiro do Termux, sem fork completo nesta fase.
- `TermuxBridge` executa scripts via `com.termux.RUN_COMMAND`.
- `MainActivity`:
  - inicia/para o ambiente;
  - executa preparação/atualização;
  - mostra código de 6 dígitos;
  - lista pedidos e permite aprovar/recusar;
  - lista ferramentas e instala via connector;
  - abre o VSX local ou o Termux.
- `EduTerminalService`: serviço em primeiro plano com notificação e verificação de saúde.
- `ConnectorClient` acessa `http://127.0.0.1:8765` (rotas admin permitidas por loopback).
- Workflow `.github/workflows/eduterminal-apk.yml` compila debug ou release assinado.

---

## 5. O que está sendo implementado agora

| Item | Estado | Próximo passo |
|---|---|---|
| Integração do pareamento no VSX | ✅ | Validar manualmente no navegador |
| Seleção do EduTerminal como ponte | ✅ | Reutiliza `bridge.js`/`workspace.js` com URL/token salvos |
| VSX same-origin em `/vsx/` | ✅ | Testar no Termux real |
| Scripts Termux | ✅/🔍 | Validar instalação e bootstrap no Android |
| App Android | 🟡 | Compilar via GitHub Actions e corrigir erros de build |
| Workflow de APK | 🟡 | Rodar o workflow e publicar o artefato |
| Documentação viva | ✅ | Manter atualizada a cada etapa |

---

## 6. O que falta implementar

### Prioridade 0 — necessário para o objetivo central

| # | Item | Estado | Detalhe |
|---|---|---|---|
| 1 | Modal de conexão no VSX | ✅ | URL, código de 6 dígitos, nome, estado e botão desconectar |
| 2 | Uso do EduTerminal como ponte | ✅ | `bridge.url`/`bridge.secret` preenchidos e modo bridge ativado |
| 3 | Terminal xterm.js no VSX | ⬜ | Substituir/conviver com o chat atual e usar `/ws` |
| 4 | App Android companheiro | 🟡 | Classes escritas; falta compilar e validar |
| 5 | Instalador Termux | ✅/🔍 | Script criado; validar no dispositivo |
| 6 | Bootstrap do ambiente | ✅/🔍 | Scripts criados; validar no dispositivo |
| 7 | Workflow de APK | 🟡 | Workflow criado; falta executar e publicar |
| 8 | HTTPS/WSS ou same-origin | ✅/🟡 | `/vsx/` same-origin implementado; WSS opcional pendente |
| 9 | Teste ponta a ponta | ⬜ | VSX → pareamento → terminal → OpenCode → arquivo alterado |
| 10 | Validação ARM64 | ⛔/🔍 | Node, Git, Python e OpenCode no Termux |
| 11 | Distribuição | ⬜ | APK assinado, página de download, versão e GPLv3 |

### Prioridade 1 — robustez e experiência

- Reconexão automática do WebSocket e retomada de sessão.
- Indicador de latência e estado da rede.
- Progresso de instalação de ferramentas no VSX.
- Gerenciador de arquivos no VSX.
- Múltiplas sessões e troca de sessão ativa.
- Logs e diagnóstico no app Android.
- Persistência de workspace e preferências.
- Testes de integração do VSX com o connector.
- Testes em Android 11+ real.

### Prioridade 2 — evolução

- Fork completo do Termux com interface própria (em vez de app companheiro).
- Atualizações OTA do connector.
- Modo offline com recursos já instalados.
- Assinatura e verificação de integridade do APK.
- Documentação para estudantes e professores.

---

## 7. Decisões tomadas

| Decisão | Motivo |
|---|---|
| Connector implementa o formato da ponte do VSX | Permite reutilizar `bridge.js` e `workspace.js` sem reescrever o VSX |
| App companheiro do Termux nesta fase | Evita manter um fork completo do Termux antes de validar o fluxo |
| `node-pty` opcional | Permite funcionar sem compilação nativa; recomendado no Termux |
| WebSocket implementado sem dependências | Menos peso e menos risco de supply chain no Android |
| Pareamento com aprovação explícita | Atende §7 e evita que qualquer página na rede abra o terminal |
| `autoApprove` só em dev/testes | Facilita testes sem enfraquecer o padrão |
| Token de 8 h | Equilíbrio entre usabilidade e segurança |
| Workspace com proteção de path traversal | Impede acesso fora da pasta aberta |
| Servir o VSX pelo próprio connector (`/vsx/`) | Alternativa same-origin para contornar mixed content/PNA |

---

## 8. Riscos e bloqueios

| Risco | Impacto | Mitigação |
|---|---|---|
| GitHub Pages é HTTPS e o connector local é HTTP | Navegador pode bloquear a conexão (mixed content/PNA) | WSS com certificado local, same-origin via connector ou app WebView |
| Sem Java/Gradle/Android SDK no ambiente local | Não é possível gerar APK aqui | Workflow no GitHub Actions |
| OpenCode pode não rodar em ARM64/Termux | RF07 não atendido | Validar cedo; documentar alternativas |
| `node-pty` exige compilação | Terminal sem TTY real | Fallback por pipes + recomendação de instalação |
| Termux `RUN_COMMAND` exige configuração | App companheiro pode não iniciar comandos | Instruir permissões e validar no dispositivo |
| Token no `localStorage` | XSS no VSX poderia expor token | CSP, dependências mínimas, expiração curta e revogação |
| Repositório privado do GitHub | Clone exige token | Token só em memória/armazenamento local; nunca no connector remoto |
| Rede Wi-Fi instável | Sessões caem | Reconexão e retomada (prioridade 1) |

---

## 9. Como executar e testar hoje

```powershell
cd EduTerminal/connector
npm test
npm start
```

O `npm start` abre o connector em `http://localhost:8765/` e mostra no terminal:

- código de pareamento;
- URLs de acesso na rede local;
- estado do OpenCode.

No mesmo connector:

- `http://localhost:8765/` — painel local (código, pedidos, tokens, ferramentas);
- `http://localhost:8765/vsx/` — VSX servido na mesma origem.

No Termux (Android):

```bash
bash ~/vsx/EduTerminal/installer/termux-install.sh
bash ~/vsx/EduTerminal/bootstrap/start.sh
bash ~/vsx/EduTerminal/bootstrap/status.sh
```

No GitHub Actions:

- `EduTerminal Connector` roda os testes do connector;
- `EduTerminal APK` gera `eduterminal-apk` (debug ou release assinado, se os segredos existirem).

Segredos opcionais para APK assinado: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Variáveis principais:

| Variável | Padrão | Função |
|---|---|---|
| `EDUTERMINAL_PORT` | `8765` | Porta do servidor |
| `EDUTERMINAL_HOST` | `0.0.0.0` | Interface de escuta |
| `EDUTERMINAL_PAIRING_TTL` | `120000` | Validade do código (ms) |
| `EDUTERMINAL_TOKEN_TTL` | `28800000` | Validade do token (ms) |
| `EDUTERMINAL_MAX_SESSIONS` | `4` | Sessões simultâneas |
| `EDUTERMINAL_AUTO_APPROVE` | desligado | Aprovação automática (só dev) |
| `EDUTERMINAL_OPENCODE` | `opencode` | Binário do OpenCode |
| `EDUTERMINAL_TLS_KEY` / `EDUTERMINAL_TLS_CERT` | vazio | Ativa HTTPS/WSS |
| `EDUTERMINAL_ALLOWED_ORIGINS` | `github.io`, localhost | Origens CORS |

---

## 10. Histórico de atualizações

| Data | Versão | Mudança |
|---|---|---|
| 30/10/2026 | 0.1 | Criação do documento; connector, pareamento, WebSocket, workspace, OpenCode e testes registrados; cliente inicial do VSX em andamento |
| 30/10/2026 | 0.2 | Cliente VSX integrado; `/vsx/` same-origin; scripts Termux; scaffold e classes Android; workflows de APK e testes; 19 testes passando |

---

## 11. Próxima atualização prevista

Após compilar o APK no GitHub Actions:

- registrar o resultado do build e corrigir eventuais erros de Java/Gradle;
- validar `installer/termux-install.sh` e `bootstrap/start.sh` em Android real;
- testar o fluxo VSX → pareamento → aprovação → workspace/OpenCode;
- implementar o terminal xterm.js no VSX usando `/ws`;
- atualizar o mapa da especificação (§9, §10 e §14) e o histórico.
