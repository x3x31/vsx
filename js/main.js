import { bridge, clearToken, connect, getToken, github, setToken, workspace } from "./api.js";
import { el, toast } from "./dom.js";
import { EditorPanel } from "./editor.js";
import { FileTree } from "./tree.js";
import { GitPanel } from "./git.js";
import { RepoPanel } from "./repos.js";
import { Terminal } from "./terminal.js";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  repo: null,
  files: [],
  bridge: { online: false, url: bridge.url },
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
  onSaved: () => refreshStatus(),
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

function updateCallbackHint() {
  const input = $("oauth-callback-input");
  if (!input) return;
  const saved = localStorage.getItem("vsx.oauth.callback");
  if (saved) {
    input.value = saved;
    return;
  }
  input.value = `${bridge.url.replace(/\/$/, "")}/oauth/callback`;
}

function openConnectModal() {
  const local = state.bridge.local;
  $("connect-error").hidden = true;
  $("connect-token").value = getToken() || "";
  $("btn-disconnect").hidden = !state.user;
  $("oauth-panel").hidden = true;
  // no modo local a ponte ja tem o Client ID e o endereco de retorno e a
  // propria origem: nada disso precisa ser preenchido
  $("client-id-row").hidden = local;
  $("callback-block").hidden = local;
  $("oauth-client-id").value = localStorage.getItem("vsx.oauth.clientId") || "";
  updateCallbackHint();
  $("modal-connect").hidden = false;
  if (!local) $("connect-token").focus();
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

/**
 * Fluxo web do GitHub com PKCE.
 *
 * O navegador abre a página de autorização do GitHub; ao aceitar, ele é
 * redirecionado para a ponte, que troca o código por um token e devolve o
 * vsx pela URL. Como isso é navegação (e não fetch), funciona mesmo quando
 * a ponte está no loopback e a página do vsx está no GitHub Pages.
 */
async function startOAuth() {
  const errorNode = $("connect-error");
  errorNode.hidden = true;

  // No modo local (app servido pela ponte) nao ha nada a checar: e o mesmo
  // modelo do VS Code — abrir o GitHub e autorizar.
  if (state.bridge.local) {
    const clientId = await localClientId();
    if (!clientId) {
      $("client-id-row").hidden = false;
      $("oauth-client-id").focus();
      errorNode.textContent =
        "A ponte ainda nao tem um Client ID de OAuth App. Informe abaixo, ou rode o vsx com " +
        "GITHUB_OAUTH_CLIENT_ID.";
      errorNode.hidden = false;
      return;
    }
    openAuthorization(clientId, `${bridge.url.replace(/\/$/, "")}/oauth/callback`);
    return;
  }

  // A ponte e consultada por fetch, mas a autorizacao volta por navegacao.
  // O Chrome bloqueia fetch de uma origem publica para 127.0.0.1, mas
  // libera a navegacao — entao a checagem aqui e apenas um aviso.
  if (!state.bridge.reachable) {
    const found = await detectBridge();
    if (found) toast(`Ponte conectada em ${bridge.url}`, "success");
  }

  if (!state.bridge.reachable) {
    errorNode.textContent =
      "A ponte nao respondeu, mas a janela de autorizacao pode funcionar: o GitHub redireciona " +
      "para o endereco de retorno por navegacao, e isso funciona mesmo quando o fetch e bloqueado. " +
      "Se a janela der erro de conexao, ajuste o endereco de retorno abaixo.";
    errorNode.hidden = false;
  }

  const clientId = (
    $("oauth-client-id").value.trim() ||
    localStorage.getItem("vsx.oauth.clientId") ||
    ""
  ).trim();

  if (!clientId) {
    $("client-id-row").hidden = false;
    $("oauth-client-id").focus();
    errorNode.textContent =
      "Informe o Client ID do OAuth App (crie um em https://github.com/settings/developers).";
    errorNode.hidden = false;
    return;
  }
  localStorage.setItem("vsx.oauth.clientId", clientId);

  const redirectUri = (
    $("oauth-callback-input").value.trim() || `${bridge.url.replace(/\/$/, "")}/oauth/callback`
  ).replace(/\/+$/, "");
  localStorage.setItem("vsx.oauth.callback", redirectUri);

  openAuthorization(clientId, redirectUri);
}

/** Client ID configurado na ponte local. */
async function localClientId() {
  const typed = $("oauth-client-id").value.trim();
  if (typed) {
    localStorage.setItem("vsx.oauth.clientId", typed);
    return typed;
  }
  const saved = localStorage.getItem("vsx.oauth.clientId");
  if (saved) return saved;
  try {
    const config = await bridge.request("GET", "/api/oauth/config");
    if (config.clientId) {
      localStorage.setItem("vsx.oauth.clientId", config.clientId);
      $("oauth-client-id").value = config.clientId;
      return config.clientId;
    }
  } catch {
    /* a ponte nao respondeu */
  }
  return "";
}

/** Abre a janela de autorizacao do GitHub. */
async function openAuthorization(clientId, redirectUri) {
  // o popup precisa abrir dentro do gesto do clique: abrir ja em branco e
  // so depois apontar para a URL de autorizacao (o await do challenge viria
  // depois, e nao antes, senao o navegador bloqueia)
  const popup = window.open("about:blank", "vsx-github", "width=960,height=760");

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
  $("btn-copy-callback").onclick = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      toast("Endereco de retorno copiado", "success");
    } catch {
      toast(redirectUri);
    }
  };

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
 * Volta da janela de autorizacao.
 * O token nao vem na URL: ele fica na ponte. A pagina so recebe a
 * confirmacao e pergunta o estado a ela — como o VS Code faz.
 */
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

/** Adota a conexao que a ponte guardou (o token nunca chega ao navegador). */
async function adoptBridgeConnection() {
  try {
    const status = await bridge.request("GET", "/api/state");
    if (!status.connected || !status.user) throw new Error("a ponte ainda nao tem conexao");
    state.user = status.user;
    workspace.setMode("bridge");
    $("modal-connect").hidden = true;
    $("user-label").textContent = status.user.login;
    $("btn-user").title = `Conectado como ${status.user.login}`;
    toast(`Conectado ao GitHub como ${status.user.login}`, "success");
    await repos.load();
  } catch (err) {
    const errorNode = $("connect-error");
    errorNode.textContent = err.message;
    errorNode.hidden = false;
    $("modal-connect").hidden = false;
  }
}

async function doConnect() {
  const token = $("connect-token").value.trim();
  const errorNode = $("connect-error");
  errorNode.hidden = true;
  $("btn-connect").disabled = true;
  try {
    await finishConnect(token);
  } catch (err) {
    errorNode.textContent = err.message;
    errorNode.hidden = false;
  } finally {
    $("btn-connect").disabled = false;
  }
}

/** Grava o token, identifica a conta e carrega os repositórios. */
async function finishConnect(token) {
  const user = await connect(token);
  state.user = user;
  $("modal-connect").hidden = true;
  $("oauth-panel").hidden = true;
  $("client-id-row").hidden = true;
  $("user-label").textContent = user.login;
  $("btn-user").title = `Conectado como ${user.login}`;
  toast(`Conectado ao GitHub como ${user.login}`, "success");
  await repos.load();
}

async function disconnect() {
  try {
    clearToken();
    state.user = null;
    state.repo = null;
    $("user-label").textContent = "Conectar";
    $("btn-user").title = "Conexão com o GitHub";
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
  const { online, reachable } = state.bridge;
  button.textContent = online ? "ponte: on-line" : reachable ? "ponte: senha" : "ponte: off-line";
  button.classList.toggle("online", online);
  button.title = online
    ? `Ponte local ativa (${state.bridge.url}) — terminal OpenCode disponível`
    : reachable
      ? `A ponte em ${state.bridge.url} exige a senha. Clique para informá-la.`
      : `Ponte local não encontrada (${state.bridge.url}). Clique para configurar.`;
}

async function detectBridge() {
  // a pagina servida pela propria ponte e o caso principal (modelo VS Code)
  if (await bridge.detectLocal()) {
    state.bridge = { online: bridge.online, reachable: true, local: true, url: bridge.url };
    workspace.setMode("bridge");
    renderBridgeStatus();
    updateCallbackHint();
    return { local: true };
  }

  const info = await bridge.discover();
  const reachable = Boolean(info);
  const online = reachable && !info.requiresSecret;
  state.bridge = { online, reachable, local: false, url: bridge.url, info };
  workspace.setMode(online ? "bridge" : "github");
  renderBridgeStatus();
  updateCallbackHint();
  return info;
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
    .then((info) => {
      const reachable = Boolean(info);
      const online = reachable && !info.requiresSecret;
      state.bridge = { online, reachable, url: bridge.url, info };
      workspace.setMode(online ? "bridge" : "github");
      renderBridgeStatus();
      $("bridge-url").value = bridge.url;
      status.textContent = info
        ? `ponte encontrada em ${bridge.url}`
        : `nenhuma ponte respondeu (${(bridge.tried || []).join(", ")})`;
      if (info) {
        toast(`Ponte conectada em ${bridge.url}`, "success");
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
  updateCallbackHint();

  if (info) {
    $("modal-bridge").hidden = true;
    toast(`Ponte conectada em ${bridge.url}`, "success");
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

function startStream() {
  if (!state.bridge.online) return;
  const source = bridge.events();

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

/* ------------------------------------------------------------- splitter */

function setupSplitter() {
  const splitter = $("splitter");
  const terminalEl = $("terminal");
  let dragging = false;

  const apply = (clientY) => {
    const rect = document.querySelector(".panel-main").getBoundingClientRect();
    const size = Math.min(Math.max(rect.bottom - clientY, 120), rect.height - 160);
    terminalEl.style.flex = `0 0 ${size}px`;
  };

  splitter.addEventListener("mousedown", (event) => {
    dragging = true;
    event.preventDefault();
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (event) => {
    if (dragging) apply(event.clientY);
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
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
  setupSplitter();
  setupShortcuts();

  $("btn-connect").addEventListener("click", doConnect);
  $("btn-oauth").addEventListener("click", startOAuth);
  $("btn-test-callback").addEventListener("click", () => {
    const url = $("oauth-callback-input").value.trim();
    if (!url) return;
    window.open(url, "vsx-teste", "width=700,height=420");
  });
  $("btn-connect-cancel").addEventListener("click", () => ($("modal-connect").hidden = true));
  $("btn-disconnect").addEventListener("click", disconnect);
  $("btn-user").addEventListener("click", openConnectModal);
  $("btn-bridge").addEventListener("click", openBridgeModal);
  $("btn-bridge-cancel").addEventListener("click", () => ($("modal-bridge").hidden = true));
  $("btn-bridge-save").addEventListener("click", saveBridge);
  $("btn-sync").addEventListener("click", syncRepo);
  $("btn-new-file").addEventListener("click", createFile);
  $("branch-select").addEventListener("change", (event) => switchBranch(event.target.value));
  $("btn-commit").addEventListener("click", openCommitModal);
  $("btn-commit-send").addEventListener("click", sendCommit);
  $("btn-commit-cancel").addEventListener("click", () => ($("modal-commit").hidden = true));

  $("connect-token").addEventListener("keydown", (event) => {
    if (event.key === "Enter") doConnect();
  });

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
        $("user-label").textContent = status.user.login;
        $("btn-user").title = `Conectado como ${status.user.login}`;
        await repos.load();
        return;
      }
    } catch {
      /* a ponte nao respondeu */
    }
  }

  if (getToken()) {
    try {
      state.user = await github.getUser();
      $("user-label").textContent = state.user.login;
      $("btn-user").title = `Conectado como ${state.user.login}`;
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

// se a página foi aberta pela janela de autorização, entrega o token e fecha
if (window.opener && window.opener !== window) {
  handleOAuthReturn().then((handled) => {
    if (!handled) window.close();
  });
} else {
  boot();
}
