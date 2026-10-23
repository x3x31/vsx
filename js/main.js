import {
  bridge,
  broker,
  clearToken,
  connect,
  getToken,
  github,
  loadCodespace,
  saveCodespace,
  setToken,
  workspace,
} from "./api.js";
import { el, toast } from "./dom.js";
import { EditorPanel } from "./editor.js";
import { FileTree } from "./tree.js";
import { GitPanel } from "./git.js";
import { setupLayout } from "./layout.js";
import { RepoPanel } from "./repos.js";
import { Terminal } from "./terminal.js";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  repo: null,
  files: [],
  bridge: { online: false, url: bridge.url },
  codespace: loadCodespace(),
};

/* ----------------------------------------------------------------- painéis */

const repos = new RepoPanel({
  listNode: $("repo-list"),
  searchNode: $("repo-search"),
  reloadNode: $("btn-reload-repos"),
  onSelect: (repo) => openRepo(repo.fullName),
});

const tree = new FileTree({
  container: $("file-tree"),
  emptyNode: $("tree-empty"),
  onOpen: (path) => editor.open(path),
});

const editor = new EditorPanel({
  host: $("editor-host"),
  emptyNode: $("editor-empty"),
  tabbar: $("tabbar"),
  tabbarEmpty: $("tabbar-empty"),
  onOpen: (path) => {
    tree.setSelected(path);
    setDirtyMarks();
  },
  onDirty: () => setDirtyMarks(),
  onSaved: () => {
    updateSaveButton();
    refreshStatus();
  },
});

const git = new GitPanel({
  container: $("git-status"),
  listNode: $("changes-list"),
  countNode: $("changes-count"),
  onOpenFile: (path) => editor.open(path),
});

const terminal = new Terminal({
  logNode: $("terminal-log"),
  formNode: $("terminal-form"),
  inputNode: $("terminal-input"),
  targetNode: $("terminal-target"),
  modelSelect: $("terminal-model"),
  agentSelect: $("terminal-agent"),
  interruptButton: $("btn-interrupt"),
  newSessionButton: $("btn-new-session"),
  clearButton: $("btn-clear-terminal"),
  permissionsNode: $("terminal-permissions"),
  getSession: () => state.repo,
});

/* --------------------------------------------------------------- repo open */

async function renderBranches(current) {
  const select = $("branch-select");
  select.replaceChildren();
  try {
    const branches = await workspace.listBranches(state.repo.fullName);
    for (const branch of branches) {
      const option = new Option(branch.name, branch.name);
      if (branch.name === current) option.selected = true;
      select.append(option);
    }
    if (!branches.some((branch) => branch.name === current)) {
      select.append(new Option(current, current));
      select.value = current;
    }
  } catch {
    select.append(new Option(current, current));
    select.value = current;
  }
}

async function openRepo(fullName) {
  repos.setActive(fullName);
  toast(`Abrindo ${fullName}...`);

  try {
    const result = await workspace.open(fullName);
    state.repo = { ...result.repo, branch: result.branch };
    state.files = result.files;

    $("repo-chip").hidden = false;
    $("repo-empty").hidden = true;
    $("repo-owner").textContent = `${fullName.split("/")[0]}/`;
    $("repo-name").textContent = fullName.split("/")[1];
    await renderBranches(result.branch);

    $("btn-sync").disabled = false;
    const canWrite = result.permissions?.push !== false;
    $("btn-commit").disabled = !canWrite;
    $("btn-commit").title = canWrite
      ? "Criar commit e enviar ao GitHub"
      : "Você não tem permissão de escrita neste repositório";

    tree.setFiles(state.files);
    tree.setSelected(null);
    $("files-count").textContent = `${state.files.length} arquivos`;

    git.setStatus({ entries: result.status || [] });
    setDirtyMarks();

    editor.closeAll();
    await terminal.attach();
  } catch (err) {
    toast(err.message || "Não foi possível abrir o repositório", "error");
  }
}

async function syncRepo() {
  if (!state.repo) return;
  toast("Sincronizando com o GitHub...");
  try {
    const result = await workspace.open(state.repo.fullName, state.repo.branch);
    state.repo = { ...result.repo, branch: result.branch };
    state.files = result.files;
    tree.setFiles(state.files);
    git.setStatus({ entries: result.status || [] });
    await renderBranches(result.branch);
    toast("Repositório sincronizado com o GitHub", "success");
  } catch (err) {
    toast(err.message || "Falha ao sincronizar", "error");
  }
}

async function switchBranch(branch) {
  if (!state.repo || !branch || branch === state.repo.branch) return;
  toast(`Trocando para ${branch}...`);
  try {
    const result = await workspace.open(state.repo.fullName, branch);
    state.repo = { ...result.repo, branch: result.branch };
    state.files = result.files;
    tree.setFiles(state.files);
    git.setStatus({ entries: result.status || [] });
    editor.closeAll();
    await terminal.attach();
    toast(`Branch ${result.branch} ativa`, "success");
  } catch (err) {
    toast(err.message || "Não foi possível trocar de branch", "error");
    await renderBranches(state.repo.branch);
  }
}

async function createFile() {
  if (!state.repo) {
    toast("Abra um repositório primeiro", "error");
    return;
  }
  const path = window.prompt("Caminho do novo arquivo (ex.: src/novo.js):");
  if (!path) return;
  try {
    await workspace.createFile(path.trim(), "");
    toast(`Arquivo criado: ${path}`, "success");
    await refreshFileList();
    editor.open(path.trim());
  } catch (err) {
    toast(err.message || "Não foi possível criar o arquivo", "error");
  }
}

async function refreshStatus() {
  if (!state.repo) return;
  try {
    git.setStatus({ entries: await workspace.listChanges() });
    setDirtyMarks();
  } catch {
    /* ignore */
  }
}

async function refreshFileList() {
  if (!state.repo) return;
  try {
    const result = await workspace.open(state.repo.fullName, state.repo.branch);
    state.files = result.files;
    tree.setFiles(state.files);
    $("files-count").textContent = `${state.files.length} arquivos`;
  } catch {
    /* ignore */
  }
}

function setDirtyMarks() {
  const dirty = git.entries.filter((entry) => entry.status !== "deleted").map((entry) => entry.path);
  tree.setDirty(dirty);
  updateSaveButton();
}

/** O botão de salvar só fica disponível com alteração não salva na aba ativa. */
function updateSaveButton() {
  $("btn-save").disabled = !editor.activeDirty;
}

/* ----------------------------------------------------------------- commit */

function openCommitModal() {
  const entries = git.entries;
  if (!entries.length) {
    toast("Não há alterações para enviar", "error");
    return;
  }
  $("commit-summary").textContent = `${entries.length} arquivo(s) alterado(s) serão enviados para ${
    state.repo?.fullName || "o repositório"
  } (branch ${state.repo?.branch || "?"}).`;
  $("commit-message").value = "";
  $("commit-error").hidden = true;
  $("modal-commit").hidden = false;
  $("commit-message").focus();
}

async function sendCommit() {
  const message = $("commit-message").value.trim() || "Atualizações via vsx";
  const errorNode = $("commit-error");
  errorNode.hidden = true;
  try {
    const result = await workspace.commit(message);
    $("modal-commit").hidden = true;
    toast(`Commit ${result.sha} enviado para ${result.branch}`, "success");
    await refreshStatus();
    await refreshFileList();
  } catch (err) {
    errorNode.textContent = err.message;
    errorNode.hidden = false;
  }
}

/* ------------------------------------------------------------- github auth */

/** Endereço de retorno padrao, conforme o modo. */
function defaultCallback() {
  // no modo local a ponte e a propria origem; no remoto, a pagina do vsx
  return state.bridge.local
    ? `${bridge.url.replace(/\/$/, "")}/oauth/callback`
    : `${location.origin}${location.pathname}`;
}

/**
 * Onde o codigo da autorizacao vira token.
 *
 * O navegador nao consegue fazer a troca sozinho: `github.com/login/**` nao
 * tem CORS (ESPECIFICACAO.md §2.1). Quem troca e o broker publicado ou,
 * havendo, a ponte local — as duas rotas devolvem `{ token }` para cá.
 */
function exchangeChannel() {
  if (broker.configured) return { name: "broker", url: broker.url };
  if (state.bridge.reachable || state.codespace?.online) {
    return { name: state.codespace?.online ? "codespace" : "ponte", url: bridge.url };
  }
  return null;
}

/** Troca o codigo por token, tentando os pontos disponiveis (broker, ponte). */
async function exchangeCode(payload) {
  const channels = [];
  if (broker.configured) channels.push({ name: "broker", run: () => broker.exchange(payload) });
  if (state.bridge.reachable || state.codespace?.online) {
    channels.push({ name: "ponte", run: () => bridge.request("POST", "/oauth/exchange", payload) });
  }
  if (!channels.length) {
    throw new Error("nenhum broker nem ponte configurado");
  }

  const attempts = [];
  for (const channel of channels) {
    try {
      return await channel.run();
    } catch (err) {
      attempts.push(`${channel.name}: ${err.message}`);
    }
  }
  throw new Error(attempts.join(" · "));
}

/** Mostra quem está conectado e oferece (ou não) o botão de sair. */
function renderUser() {
  const login = state.user?.login || null;
  $("user-label").textContent = login || "Conectar";
  $("btn-user").title = login ? `Conectado como ${login}` : "Conexão com o GitHub";
  $("btn-logout").hidden = !login;
}

function openConnectModal() {
  $("connect-error").hidden = true;
  $("btn-disconnect").hidden = !state.user;
  $("oauth-panel").hidden = true;
  $("modal-connect").hidden = false;
  $("btn-oauth").focus();

  // aquece o Client ID (broker/ponte) em segundo plano: quando o usuario
  // clicar em "Conectar", ele ja esta no localStorage e o clique nao espera
  if (!localStorage.getItem("vsx.oauth.clientId")) {
    resolveClientId().catch(() => {});
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function sha256Base64url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url(digest);
}

function randomVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(48)));
}

function decodeBase64url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/**
 * Fluxo web do GitHub com PKCE — o mesmo modelo do VS Code: um clique,
 * a janela do GitHub, "Authorize", e o vsx fica conectado.
 *
 * O navegador abre a página de autorização; ao aceitar, o GitHub devolve um
 * `code` para a própria página do vsx (é navegação, então funciona mesmo com
 * a página no GitHub Pages). O `code` ainda precisa virar token — e essa é a
 * única parte que o navegador não faz (github.com/login/** não tem CORS):
 * quem faz é o broker (broker/) ou a ponte, e o token volta para o navegador
 * de quem autorizou.
 */
async function startOAuth() {
  const errorNode = $("connect-error");
  errorNode.hidden = true;

  // A janela nasce aqui, dentro do gesto do clique: descobrir a ponte e
  // perguntar o Client ID ao broker são awaits, e depois deles o Chrome já
  // teria bloqueado o window.open (bug registrado em ESPECIFICACAO.md §12.1).
  const popup = window.open("about:blank", "vsx-github", "width=960,height=760");
  const abort = (message) => {
    if (popup && !popup.closed) popup.close();
    errorNode.textContent = message;
    errorNode.hidden = false;
    return false;
  };

  try {
    return await authorize(popup, abort);
  } catch (err) {
    if (popup && !popup.closed) popup.close();
    errorNode.textContent = err.message;
    errorNode.hidden = false;
    return false;
  }
}

async function authorize(popup, abort) {
  // No modo local (app servido pela ponte) nao ha nada a checar: e o mesmo
  // modelo do VS Code — abrir o GitHub e autorizar.
  if (state.bridge.local) {
    const clientId = await resolveClientId();
    if (!clientId) {
      return abort(
        "A ponte ainda nao tem um Client ID de OAuth App. Rode o vsx com GITHUB_OAUTH_CLIENT_ID " +
          "e tente de novo.",
      );
    }
    openAuthorization(clientId, defaultCallback(), popup);
    return true;
  }

  // A autorizacao volta por navegacao (isso sempre funciona), mas a troca do
  // codigo por token nao pode ser feita pelo navegador: github.com/login/**
  // nao tem CORS. Quem troca e o broker publicado ou a ponte — ambos exigem
  // que estejam acessiveis daqui, entao conferimos antes de abrir o GitHub.
  if (!state.bridge.reachable && !state.codespace?.online) {
    const found = await detectBridge();
    if (found) toast(`Ponte conectada em ${bridge.url}`, "success");
  }

  if (!exchangeChannel()) {
    return abort(
      "Nenhum ponto para trocar o código da autorização por token. Suba a ponte local com " +
        "`npm run start:public` (veja broker/README.md) ou publique o broker e recarregue a página.",
    );
  }

  const clientId = await resolveClientId();

  if (!clientId) {
    return abort(
      "Não achei o Client ID do OAuth App do vsx. Publique-o no broker (broker/wrangler.toml) ou " +
        "rode a ponte com GITHUB_OAUTH_CLIENT_ID — e cadastre " +
        `${defaultCallback()} como Authorization callback URL em https://github.com/settings/developers.`,
    );
  }

  // No modo remoto a autorizacao volta para a propria pagina do vsx: assim o
  // endereco de retorno nao depende de onde ficam a ponte e o broker, e
  // tambem nao passa pelo gate de porta do Codespace (que descarta a query
  // numa navegacao para uma porta privada).
  //
  // O valor vai ao GitHub exatamente como esta: o GitHub compara o
  // redirect_uri caractere a caractere com o cadastrado no OAuth App, e
  // normalizar (por exemplo, tirar a barra final) faz a autorizacao falhar
  // com "the redirect_uri is not associated with this application".
  openAuthorization(clientId, defaultCallback(), popup);
  return true;
}

/**
 * Client ID do vsx: o salvo — ou o que a ponte e o broker já têm pronto
 * (no modo local quem manda é a ponte; no remoto, o broker).
 */
async function resolveClientId() {
  const saved = localStorage.getItem("vsx.oauth.clientId");
  if (saved) return saved;

  const fromBroker = async () => {
    if (!broker.configured) return null;
    try {
      const info = await broker.info();
      return info?.clientId || null;
    } catch {
      return null;
    }
  };

  const fromBridge = async () => {
    try {
      const config = await bridge.request("GET", "/api/oauth/config");
      return config?.clientId || null;
    } catch {
      return null;
    }
  };

  const sources = state.bridge.local ? [fromBridge, fromBroker] : [fromBroker, fromBridge];
  for (const source of sources) {
    const clientId = await source();
    if (clientId) {
      localStorage.setItem("vsx.oauth.clientId", clientId);
      return clientId;
    }
  }
  return "";
}

/**
 * Aponta a janela de autorizacao para a URL do GitHub.
 *
 * @param popup janela ja aberta em branco (aberta em startOAuth, dentro do
 *              gesto do clique — o await do challenge acontece depois de
 *              abri-la, e o navegador bloquearia um window.open posterior)
 */
async function openAuthorization(clientId, redirectUri, popup = null) {
  const verifier = randomVerifier();
  const challenge = await sha256Base64url(verifier);
  const returnTo = `${location.origin}${location.pathname}`;
  const oauthState = base64url(
    new TextEncoder().encode(JSON.stringify({ v: verifier, r: returnTo, c: clientId, u: redirectUri })),
  );

  const url =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=repo` +
    `&state=${encodeURIComponent(oauthState)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256`;

  $("oauth-panel").hidden = false;
  $("oauth-status").textContent = "aguardando a autorizacao no GitHub...";
  $("btn-open-github").onclick = () => window.open(url, "vsx-github", "width=960,height=760");

  if (popup) {
    popup.location = url;
    popup.focus();
  } else {
    $("oauth-status").textContent =
      "o navegador bloqueou a janela. Clique em \u201cabrir o GitHub\u201d para permitir.";
  }
}

/** Lê o token que a ponte devolveu na URL (a janela de autorização volta para cá). */
function readOAuthResult() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = hash.get("vsx_token");
  const error = hash.get("vsx_error");
  const login = hash.get("vsx_login");
  const connected = hash.get("vsx_connected");
  if (!token && !error && !connected) return null;

  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return { token, error, login, connected: Boolean(connected) };
}

/**
 * Volta da autorização no modo remoto: o GitHub devolve o código na query da
 * própria página do vsx. O código vai para o broker (ou, havendo, para a
 * ponte), que faz a troca com o GitHub — o navegador não consegue, porque
 * `github.com/login/**` não envia CORS (ESPECIFICACAO.md §2.1).
 *
 * O token é devolvido para a página principal: quem passa a guardá-lo é o
 * navegador de quem autorizou (localStorage), como o VS Code guarda a
 * credencial da conta. Nem o broker nem a ponte o gravam.
 */
async function handleRemoteCallback(params) {
  const code = params.get("code");
  const state = params.get("state") || "";
  const error = params.get("error");

  history.replaceState(null, "", `${location.pathname}`);

  const errorNode = $("connect-error");
  const fail = (message) => {
    if (window.opener) {
      // quem autorizou foi a página principal: é lá que o erro aparece
      window.opener.postMessage({ type: "vsx-oauth", error: message }, "*");
      window.close();
      return true;
    }
    errorNode.textContent = message;
    errorNode.hidden = false;
    $("modal-connect").hidden = false;
    return true;
  };

  if (error) return fail(`O GitHub recusou a autorização: ${error}`);
  if (!code) return false;

  let payload = {};
  try {
    payload = JSON.parse(decodeBase64url(state));
  } catch {
    /* state invalido */
  }

  // esta janela foi aberta em branco pela autorização: ela mesma descobre a
  // ponte, para que o broker e a ponte entrem na fila da troca
  await detectBridge();

  try {
    const result = await exchangeCode({
      code,
      state,
      clientId: payload.c,
      redirectUri: payload.u,
      verifier: payload.v,
    });

    $("oauth-status").textContent = "autorizado!";

    if (result.token) {
      if (window.opener) {
        // quem autorizou foi a janela: ela recebe o token e conecta
        window.opener.postMessage({ type: "vsx-oauth", token: result.token }, "*");
        window.close();
        return true;
      }
      // aberta sem página principal: conecta aqui mesmo
      await finishConnect(result.token);
      return true;
    }

    // ponte no modo local: o token fica nela e a página só recebe a confirmação
    if (window.opener) {
      window.opener.postMessage({ type: "vsx-oauth", connected: true }, "*");
      window.close();
      return true;
    }
    await adoptBridgeConnection();
    return true;
  } catch (err) {
    return fail(`A troca do código por token falhou: ${err.message}`);
  }
}

async function handleOAuthReturn() {
  const result = readOAuthResult();
  if (!result) return false;

  if (result.error) {
    if (window.opener) {
      window.opener.postMessage({ type: "vsx-oauth", error: result.error }, "*");
      window.close();
      return true;
    }
    const errorNode = $("connect-error");
    errorNode.textContent = result.error;
    errorNode.hidden = false;
    $("modal-connect").hidden = false;
    return true;
  }

  if (result.connected) {
    if (window.opener) {
      window.opener.postMessage({ type: "vsx-oauth", connected: true }, "*");
      window.close();
      return true;
    }
    await adoptBridgeConnection();
    return true;
  }

  if (result.token) {
    if (window.opener) {
      window.opener.postMessage({ type: "vsx-oauth", token: result.token }, "*");
      window.close();
      return true;
    }
    await finishConnect(result.token);
    return true;
  }
  return true;
}

/**
 * Se a ponte ja tem conexao com o GitHub (de uma autorizacao anterior),
 * o app entra direto, sem pedir nada.
 */
async function adoptIfConnected() {
  if (!state.bridge.online) return false;
  try {
    const status = await bridge.request("GET", "/api/state");
    if (!status.connected || !status.user) return false;
    await adoptBridgeConnection();
    return true;
  } catch {
    return false;
  }
}

/** Adota a conexao que a ponte guardou (o token nunca chega ao navegador). */
async function adoptBridgeConnection() {
  try {
    const status = await bridge.request("GET", "/api/state");
    if (!status.connected || !status.user) throw new Error("a ponte ainda nao tem conexao");
    state.user = status.user;
    workspace.setMode(state.codespace?.online && !state.bridge.local ? "codespace" : "bridge");
    $("modal-connect").hidden = true;
    renderUser();
    toast(`Conectado ao GitHub como ${status.user.login}`, "success");
    await repos.load();
  } catch (err) {
    const errorNode = $("connect-error");
    errorNode.textContent = err.message;
    errorNode.hidden = false;
    $("modal-connect").hidden = false;
  }
}

/** Grava o token, identifica a conta e carrega os repositórios. */
async function finishConnect(token) {
  const user = await connect(token);
  state.user = user;
  $("modal-connect").hidden = true;
  $("oauth-panel").hidden = true;
  renderUser();
  toast(`Conectado ao GitHub como ${user.login}`, "success");
  await repos.load();
}

async function disconnect() {
  try {
    clearToken();
    state.user = null;
    state.repo = null;
    renderUser();
    $("modal-connect").hidden = true;
    $("repo-chip").hidden = true;
    $("repo-empty").hidden = false;
    $("btn-sync").disabled = true;
    $("btn-commit").disabled = true;
    $("repo-list").replaceChildren(el("div", { class: "empty-state", text: "Conecte ao GitHub" }));
    toast("Desconectado do GitHub");
  } catch (err) {
    toast(err.message || "Não foi possível desconectar", "error");
  }
}

/* ------------------------------------------------------------------ ponte */

function renderBridgeStatus() {
  const button = $("btn-bridge");
  const { online, reachable, local } = state.bridge;
  // no fluxo do aluno o Codespace é o workspace: a ponte local vira detalhe
  button.hidden = Boolean(state.codespace?.url && !local);
  button.textContent = online ? "ponte: on-line" : reachable ? "ponte: senha" : "ponte: off-line";
  button.classList.toggle("online", online);
  button.title = online
    ? `${local ? "Ponte local ativa" : "Ponte ativa"} (${state.bridge.url}) — terminal OpenCode disponível`
    : reachable
      ? `A ponte em ${state.bridge.url} exige a senha. Clique para informá-la.`
      : `Ponte local não encontrada (${state.bridge.url}). Clique para configurar.`;
}

function renderCodespaceStatus() {
  const button = $("btn-codespace");
  const cs = state.codespace;
  // no modo local (app servido pela própria ponte) o Codespace não participa
  button.hidden = Boolean(state.bridge.local);
  button.classList.toggle("online", Boolean(cs?.online));
  button.classList.toggle("stale", Boolean(cs && !cs.online));

  if (!cs?.url) {
    button.textContent = "codespace: off-line";
    button.title = "Nenhum workspace do Codespaces conectado. Clique para conectar.";
    return;
  }
  if (cs.online) {
    button.textContent = "codespace: on-line";
    button.title = `Workspace ativo: ${cs.url} — terminal OpenCode disponível`;
    return;
  }
  if (cs.stale) {
    button.textContent = "codespace: token";
    button.title = `O workspace ${cs.url} respondeu, mas recusou o token. Clique para corrigir.`;
    return;
  }
  button.textContent = "codespace: parado";
  button.title = `O workspace ${cs.url} não respondeu — pode estar parado ou expirado. Clique para retomar.`;
}

/**
 * Lê o Codespace salvo e confere se ele ainda responde com o token guardado.
 * Um workspace parado/expirado deixa de responder; um token inválido recebe 401.
 */
async function detectCodespace() {
  const saved = loadCodespace();
  if (!saved?.url || !saved?.token) {
    state.codespace = saved ? { ...saved, online: false, reachable: false } : null;
    renderCodespaceStatus();
    return null;
  }

  bridge.setUrl(saved.url);
  bridge.setSecret(saved.token);
  const info = await bridge.ping(4500);
  const reachable = Boolean(info);
  const online = reachable && !info.requiresSecret;

  state.codespace = {
    ...saved,
    online,
    reachable,
    stale: reachable && !online,
    info: online ? info : null,
  };
  renderCodespaceStatus();

  if (online) {
    workspace.setMode("codespace");
    return info;
  }
  return null;
}

async function detectBridge() {
  // a pagina servida pela propria ponte e o caso principal (modelo VS Code)
  if (await bridge.detectLocal()) {
    state.bridge = { online: bridge.online, reachable: true, local: true, url: bridge.url };
    workspace.setMode("bridge");
    renderBridgeStatus();
    renderCodespaceStatus();
    return { local: true };
  }

  // no GitHub Pages o workspace do aluno vem antes da descoberta da ponte local
  if (await detectCodespace()) {
    state.bridge = { online: false, reachable: false, local: false, url: bridge.url };
    renderBridgeStatus();
    return { codespace: true };
  }

  const info = await bridge.discover();
  const reachable = Boolean(info);
  const online = reachable && !info.requiresSecret;
  state.bridge = { online, reachable, local: false, url: bridge.url, info };
  workspace.setMode(online ? "bridge" : "github");
  renderBridgeStatus();
  return info;
}

/** Aceita `host`, `https://host` ou uma URL com barra no fim. */
function normalizeCodespaceUrl(value) {
  let url = (value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function openCodespaceModal() {
  const cs = state.codespace || loadCodespace();
  $("codespace-url").value = cs?.url || "";
  $("codespace-secret").value = cs?.token || "";
  $("codespace-error").hidden = true;
  $("btn-codespace-disconnect").hidden = !cs?.url;
  $("codespace-status").textContent = cs?.url
    ? cs.online
      ? `workspace conectado em ${cs.url}`
      : "o workspace salvo não respondeu — confira a URL e a senha, ou retome o Codespace"
    : "informe a URL pública e a senha do workspace";
  $("modal-codespace").hidden = false;
  $("codespace-url").focus();
}

async function saveCodespaceConnection() {
  const errorNode = $("codespace-error");
  const status = $("codespace-status");
  errorNode.hidden = true;

  const url = normalizeCodespaceUrl($("codespace-url").value);
  const token = $("codespace-secret").value.trim();
  const fail = (message) => {
    errorNode.textContent = message;
    errorNode.hidden = false;
    status.textContent = "";
  };

  if (!url) return fail("Informe a URL pública do workspace no Codespaces.");
  if (!token) return fail("Informe a senha impressa no terminal do Codespace.");

  status.textContent = "verificando o workspace...";
  const info = await bridge.verifyAt(url, token);

  if (!info) {
    return fail(
      `Não foi possível falar com ${url}. Confira se o Codespace está no ar, se a porta 4173 ` +
        "está pública nas Ports e se a URL está no formato https://<nome>-4173.<domínio>.",
    );
  }
  if (info.requiresSecret) {
    return fail("O workspace respondeu, mas recusou a senha. Confira o valor impresso no terminal.");
  }

  const saved = saveCodespace({
    url,
    token,
    publicUrl: info.publicUrl || url,
    savedAt: Date.now(),
  });
  state.codespace = { ...saved, online: true, reachable: true, stale: false, info };

  stopStream();
  bridge.setUrl(url);
  bridge.setSecret(token);
  workspace.setMode("codespace");
  renderCodespaceStatus();
  renderBridgeStatus();
  $("modal-codespace").hidden = true;
  toast(`Workspace conectado${info.publicUrl ? ` em ${info.publicUrl}` : ""}`, "success");
  startStream();

  // a ponte do Codespace pode já ter a conta conectada (modo local dela)
  try {
    const remote = await bridge.request("GET", "/api/state");
    if (remote.connected && remote.user) {
      await adoptBridgeConnection();
      return;
    }
  } catch {
    /* segue com o token do navegador */
  }

  if (getToken()) {
    try {
      state.user = await github.getUser();
      renderUser();
    } catch {
      /* token do navegador inválido: a janela de conexão aparece abaixo */
    }
    await repos.load();
    if (state.repo) await openRepo(state.repo.fullName);
    return;
  }

  openConnectModal();
}

async function disconnectCodespace() {
  const fullName = state.repo?.fullName || null;
  saveCodespace(null);
  state.codespace = null;

  stopStream();
  bridge.setSecret("");
  bridge.setUrl(location.origin.startsWith("http") ? location.origin : "http://127.0.0.1:4173");
  bridge.online = false;
  bridge.reachable = false;
  workspace.setMode("github");

  $("modal-codespace").hidden = true;
  renderCodespaceStatus();
  toast("Workspace do Codespaces desconectado");

  // volta para a ponte local, se houver, ou para o modo direto do GitHub
  await detectBridge();
  startStream();
  if (fullName && (workspace.online || getToken())) {
    await openRepo(fullName);
  } else {
    await terminal.attach();
  }
}

/** O navegador bloqueia páginas públicas de alcançarem endereços de loopback. */
function loopbackBlocked() {
  const pageIsLocal = ["127.0.0.1", "localhost", "::1"].includes(location.hostname);
  if (pageIsLocal) return false;
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(bridge.url).hostname);
  } catch {
    return false;
  }
}

function openBridgeModal() {
  $("bridge-url").value = bridge.url;
  $("bridge-secret").value = bridge.secret;
  $("bridge-error").hidden = true;
  $("modal-bridge").hidden = false;
  $("bridge-url").focus();

  // procura a ponte de novo: ela pode ter subido depois do carregamento
  const status = $("bridge-status");
  status.textContent = "procurando a ponte...";
  bridge
    .discover()
    .then(async (info) => {
      const reachable = Boolean(info);
      const online = reachable && !info.requiresSecret;
      state.bridge = { online, reachable, url: bridge.url, info };
      workspace.setMode(online ? "bridge" : "github");
      renderBridgeStatus();
      $("bridge-url").value = bridge.url;
      status.textContent = info
        ? online
          ? `ponte encontrada em ${bridge.url}`
          : `a ponte em ${bridge.url} exige a senha — informe abaixo`
        : `nenhuma ponte respondeu (${(bridge.tried || []).join(", ")})`;
      if (info && online) {
        toast(`Ponte conectada em ${bridge.url}`, "success");
        if (await adoptIfConnected()) return;
        if (state.repo) terminal.attach();
      }
    })
    .catch(() => {
      status.textContent = "não foi possível procurar a ponte.";
    });
}

async function saveBridge() {
  const url = $("bridge-url").value.trim();
  const secret = $("bridge-secret").value.trim();
  const errorNode = $("bridge-error");
  errorNode.hidden = true;

  if (!url) {
    errorNode.textContent = "Informe o endereço da ponte";
    errorNode.hidden = false;
    return;
  }

  bridge.setUrl(url);
  bridge.setSecret(secret);
  const info = await detectBridge();

  if (info) {
    $("modal-bridge").hidden = true;
    toast(`Ponte conectada em ${bridge.url}`, "success");
    if (await adoptIfConnected()) return;
    if (state.repo) await terminal.attach();
    return;
  }

  errorNode.textContent = loopbackBlocked()
    ? "O navegador bloqueia páginas públicas de alcançarem 127.0.0.1. No Codespace, use a URL " +
      "pública da ponte (https://<porta>-app.github.dev)."
    : bridge.lastError || `Não foi possível falar com a ponte em ${url}.`;
  errorNode.hidden = false;
}

/* ----------------------------------------------------------------- stream */

let stream = null;

function startStream() {
  // vale para a ponte local e para o Codespace (workspace.online)
  if (!workspace.online) return;
  if (stream?.url === bridge.url && stream?.secret === bridge.secret) return;

  stopStream();
  const source = bridge.events();
  stream = { url: bridge.url, secret: bridge.secret, source };

  source.addEventListener("opencode", (event) => {
    try {
      terminal.handleEvent(JSON.parse(event.data));
    } catch {
      /* payload inválido */
    }
  });
  source.addEventListener("git.status", async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!state.repo || payload.repo !== state.repo.fullName) return;
      git.setStatus(payload);
      setDirtyMarks();
    } catch {
      /* ignore */
    }
  });
  source.addEventListener("fs.changed", async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.path) editor.refreshFromDisk(payload.path);
      await refreshFileList();
    } catch {
      /* ignore */
    }
  });
  source.onerror = () => {
    /* o EventSource reconecta sozinho */
  };
}

function stopStream() {
  if (!stream) return;
  try {
    stream.source.close();
  } catch {
    /* já estava fechado */
  }
  stream = null;
}

/* -------------------------------------------------------------- shortcuts */

function setupShortcuts() {
  window.addEventListener("keydown", (event) => {
    const inTerminal = event.target === $("terminal-input");
    const inModal =
      !$("modal-connect").hidden || !$("modal-commit").hidden || !$("modal-bridge").hidden;

    if (event.key === "Escape") {
      if (inModal) {
        $("modal-connect").hidden = true;
        $("modal-commit").hidden = true;
        $("modal-bridge").hidden = true;
        return;
      }
      if (inTerminal && terminal.busy) {
        terminal.interrupt();
      }
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && inTerminal) {
      event.preventDefault();
      terminal.send();
    }
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  setupLayout({
    // o CodeMirror precisa se reajustar quando o espaço do editor muda
    onResize: () => editor.refresh(),
  });
  setupShortcuts();

  $("btn-oauth").addEventListener("click", startOAuth);
  $("btn-connect-cancel").addEventListener("click", () => ($("modal-connect").hidden = true));
  $("btn-disconnect").addEventListener("click", disconnect);
  $("btn-user").addEventListener("click", openConnectModal);
  $("btn-logout").addEventListener("click", disconnect);
  $("btn-save").addEventListener("click", () => editor.save());
  $("btn-bridge").addEventListener("click", openBridgeModal);
  $("btn-bridge-cancel").addEventListener("click", () => {
    $("modal-bridge").hidden = true;
    if (!state.bridge.online && !getToken()) openConnectModal();
  });
  $("btn-bridge-save").addEventListener("click", saveBridge);
  $("btn-sync").addEventListener("click", syncRepo);
  $("btn-new-file").addEventListener("click", createFile);
  $("branch-select").addEventListener("change", (event) => switchBranch(event.target.value));
  $("btn-commit").addEventListener("click", openCommitModal);
  $("btn-commit-send").addEventListener("click", sendCommit);
  $("btn-commit-cancel").addEventListener("click", () => ($("modal-commit").hidden = true));

  // a janela de autorização devolve o resultado por mensagem
  window.addEventListener("message", async (event) => {
    if (event.data?.type !== "vsx-oauth") return;
    if (event.data.error) {
      const errorNode = $("connect-error");
      errorNode.textContent = event.data.error;
      errorNode.hidden = false;
      $("oauth-status").textContent = event.data.error;
      return;
    }
    if (event.data.connected) {
      $("oauth-status").textContent = "autorizado!";
      await adoptBridgeConnection();
      return;
    }
    if (event.data.token) {
      $("oauth-status").textContent = "autorizado!";
      await finishConnect(event.data.token);
    }
  });

  await detectBridge();
  startStream();

  // no modo local a ponte pode ja estar conectada (como o VS Code lembra
  // do login): nesse caso o app abre pronto, sem pedir nada
  if (state.bridge.local) {
    try {
      const status = await bridge.request("GET", "/api/state");
      if (status.connected && status.user) {
        state.user = status.user;
        workspace.setMode("bridge");
        renderUser();
        await repos.load();
        return;
      }
    } catch {
      /* a ponte nao respondeu */
    }
  }

  // a ponte respondeu mas exige a senha: e ela que libera o terminal e a
  // autorizacao, entao essa janela vem primeiro
  if (state.bridge.reachable && !state.bridge.online) {
    openBridgeModal();
    return;
  }

  if (getToken()) {
    try {
      state.user = await github.getUser();
      renderUser();
      await repos.load();
    } catch (err) {
      clearToken();
      toast("Token do GitHub expirou. Conecte novamente.", "error");
      openConnectModal();
    }
  } else {
    openConnectModal();
  }
}

// a autorização pode ter voltado com ?code=... (modo remoto)
const params = new URLSearchParams(location.search);
if (params.get("code") || params.get("error")) {
  handleRemoteCallback(params).then((handled) => {
    if (!handled && window.opener) window.close();
  });
} else if (window.opener && window.opener !== window) {
  // a página foi aberta pela janela de autorização
  handleOAuthReturn().then((handled) => {
    if (!handled) window.close();
  });
} else {
  boot();
}
