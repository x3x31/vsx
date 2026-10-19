import { api, connectStream } from "./api.js";
import { clear, el, toast } from "./dom.js";
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
  stream: null,
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
    const { branches } = await api.get(
      `/api/github/branches?repo=${encodeURIComponent(state.repo.fullName)}`,
    );
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
    const result = await api.openRepo(fullName);
    state.repo = result.repo;
    state.files = result.files;

    $("repo-chip").hidden = false;
    $("repo-empty").hidden = true;
    $("repo-owner").textContent = `${result.repo.fullName.split("/")[0]}/`;
    $("repo-name").textContent = result.repo.fullName.split("/")[1];
    await renderBranches(result.repo.branch);

    $("btn-sync").disabled = false;
    $("btn-commit").disabled = !result.repo.permissions?.push;
    $("btn-commit").title = result.repo.permissions?.push
      ? "Criar commit e enviar ao GitHub"
      : "Você não tem permissão de escrita neste repositório";

    tree.setFiles(state.files);
    tree.setSelected(null);
    $("files-count").textContent = `${state.files.length} arquivos`;

    git.setStatus({ entries: result.status });
    setDirtyMarks();

    editor.closeAll();
    await terminal.attach();

    if (result.pullMessage) {
      toast(`Aviso do Git: ${result.pullMessage.split("\n")[0]}`, "error");
    }
  } catch (err) {
    toast(err.message || "Não foi possível abrir o repositório", "error");
  }
}

async function syncRepo() {
  if (!state.repo) return;
  toast("Sincronizando com o GitHub...");
  try {
    const result = await api.openRepo(state.repo.fullName, state.repo.branch);
    state.repo = result.repo;
    state.files = result.files;
    tree.setFiles(state.files);
    git.setStatus({ entries: result.status });
    await renderBranches(result.repo.branch);
    if (result.pullMessage) {
      toast(`Não foi possível atualizar: ${result.pullMessage.split("\n")[0]}`, "error");
    } else {
      toast("Repositório sincronizado com o GitHub", "success");
    }
  } catch (err) {
    toast(err.message || "Falha ao sincronizar", "error");
  }
}

async function switchBranch(branch) {
  if (!state.repo || !branch || branch === state.repo.branch) return;
  toast(`Trocando para ${branch}...`);
  try {
    const result = await api.openRepo(state.repo.fullName, branch);
    state.repo = result.repo;
    state.files = result.files;
    tree.setFiles(state.files);
    git.setStatus({ entries: result.status });
    editor.closeAll();
    await terminal.attach();
    toast(`Branch ${result.repo.branch} ativa`, "success");
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
    await api.newFile(path.trim(), "");
    toast(`Arquivo criado: ${path}`, "success");
    const { files } = await api.files();
    state.files = files;
    tree.setFiles(files);
    $("files-count").textContent = `${files.length} arquivos`;
    editor.open(path.trim());
  } catch (err) {
    toast(err.message || "Não foi possível criar o arquivo", "error");
  }
}

async function refreshStatus() {
  if (!state.repo) return;
  try {
    const status = await api.status();
    git.setStatus(status);
    setDirtyMarks();
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
    const result = await api.commit(message, state.repo?.branch);
    $("modal-commit").hidden = true;
    toast(`Commit ${result.sha} enviado para ${result.branch}`, "success");
    await refreshStatus();
  } catch (err) {
    errorNode.textContent = err.message;
    errorNode.hidden = false;
  }
}

/* ------------------------------------------------------------- github auth */

function openConnectModal() {
  $("connect-error").hidden = true;
  $("connect-token").value = "";
  $("btn-disconnect").hidden = !state.user;
  $("modal-connect").hidden = false;
  $("connect-token").focus();
}

async function disconnect() {
  try {
    await api.disconnect();
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

async function connect() {
  const token = $("connect-token").value.trim();
  const errorNode = $("connect-error");
  errorNode.hidden = true;
  $("btn-connect").disabled = true;
  try {
    const { user } = await api.connect(token);
    state.user = user;
    $("modal-connect").hidden = true;
    $("user-label").textContent = user.login;
    $("btn-user").title = `Conectado como ${user.login}`;
    toast(`Conectado ao GitHub como ${user.login}`, "success");
    await repos.load();
  } catch (err) {
    errorNode.textContent = err.message;
    errorNode.hidden = false;
  } finally {
    $("btn-connect").disabled = false;
  }
}

/* ----------------------------------------------------------------- stream */

function startStream() {
  state.stream = connectStream({
    opencode: (event) => terminal.handleEvent(event),
    opencodeError: (payload) => terminal.log("error", payload.message),
    gitStatus: (payload) => {
      if (!state.repo || payload.repo !== state.repo.fullName) return;
      git.setStatus(payload);
      setDirtyMarks();
    },
    filesChanged: async (payload) => {
      if (!state.repo) return;
      if (payload?.path) editor.refreshFromDisk(payload.path);
      try {
        const { files } = await api.files();
        state.files = files;
        tree.setFiles(files);
        $("files-count").textContent = `${files.length} arquivos`;
      } catch {
        /* ignore */
      }
    },
  });
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
    const inModal = !$("modal-connect").hidden || !$("modal-commit").hidden;

    if (event.key === "Escape") {
      if (inModal) {
        $("modal-connect").hidden = true;
        $("modal-commit").hidden = true;
        return;
      }
      if (inTerminal && terminal.busy) {
        terminal.interrupt();
        return;
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

  $("btn-connect").addEventListener("click", connect);
  $("btn-connect-cancel").addEventListener("click", () => ($("modal-connect").hidden = true));
  $("btn-disconnect").addEventListener("click", disconnect);
  $("btn-user").addEventListener("click", openConnectModal);
  $("btn-sync").addEventListener("click", syncRepo);
  $("btn-new-file").addEventListener("click", createFile);
  $("branch-select").addEventListener("change", (event) => switchBranch(event.target.value));
  $("btn-commit").addEventListener("click", openCommitModal);
  $("btn-commit-send").addEventListener("click", sendCommit);
  $("btn-commit-cancel").addEventListener("click", () => ($("modal-commit").hidden = true));

  $("connect-token").addEventListener("keydown", (event) => {
    if (event.key === "Enter") connect();
  });

  startStream();

  try {
    const current = await api.state();
    if (current.connected && current.user) {
      state.user = current.user;
      $("user-label").textContent = current.user.login;
      $("btn-user").title = `Conectado como ${current.user.login}`;
      await repos.load();
    } else {
      openConnectModal();
    }
  } catch (err) {
    toast(err.message || "Servidor indisponível", "error");
  }
}

boot();
