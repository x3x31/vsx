import { api } from "./api.js";
import { clear, el, toast } from "./dom.js";

const TOOL_SUMMARIES = {
  read: (input) => input?.path || input?.filePath || "",
  write: (input) => input?.path || input?.filePath || "",
  edit: (input) => input?.path || input?.filePath || "",
  patch: (input) => input?.path || input?.filePath || "",
  bash: (input) => input?.command || "",
  shell: (input) => input?.command || "",
  grep: (input) => input?.pattern || "",
  glob: (input) => input?.pattern || "",
  list: (input) => input?.path || "",
  ls: (input) => input?.path || "",
  webfetch: (input) => input?.url || "",
  todowrite: () => "",
};

function summarize(name, input = {}, root = "") {
  const fn = TOOL_SUMMARIES[name];
  let value = "";
  if (fn) value = fn(input) || "";
  if (!value) {
    const keys = Object.keys(input);
    return keys.length ? `${name} ${keys.slice(0, 2).join(" ")}` : name;
  }
  if (root && typeof value === "string") {
    value = value.split(root).join("").replace(/^\//, "");
  }
  return `${name} ${value}`;
}

export class Terminal {
  constructor({
    logNode,
    formNode,
    inputNode,
    targetNode,
    modelSelect,
    agentSelect,
    interruptButton,
    newSessionButton,
    clearButton,
    permissionsNode,
    getSession,
  }) {
    this.logNode = logNode;
    this.formNode = formNode;
    this.inputNode = inputNode;
    this.targetNode = targetNode;
    this.modelSelect = modelSelect;
    this.agentSelect = agentSelect;
    this.interruptButton = interruptButton;
    this.newSessionButton = newSessionButton;
    this.clearButton = clearButton;
    this.permissionsNode = permissionsNode;
    this.getSession = getSession;

    this.session = null;
    this.models = [];
    this.agents = [];
    this.stream = null;
    this.busy = false;
    this.permissionTimer = null;

    this.formNode.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send();
    });

    this.inputNode.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.send();
      }
    });

    this.inputNode.addEventListener("input", () => {
      this.inputNode.style.height = "auto";
      this.inputNode.style.height = `${Math.min(this.inputNode.scrollHeight, 140)}px`;
    });

    this.interruptButton.addEventListener("click", () => this.interrupt());
    this.newSessionButton.addEventListener("click", () => this.newSession());
    this.clearButton.addEventListener("click", () => this.clear());

    this.modelSelect.addEventListener("change", async () => {
      const option = this.modelSelect.selectedOptions[0];
      if (!option?.value) return;
      const [providerID, ...rest] = option.value.split("/");
      const id = rest.join("/");
      try {
        await api.post("/api/opencode/model", { model: { id, providerID } });
        toast(`Modelo: ${option.textContent}`, "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    this.agentSelect.addEventListener("change", async () => {
      const agent = this.agentSelect.value;
      if (!agent) return;
      try {
        await api.post("/api/opencode/agent", { agent });
        toast(`Agente: ${agent}`, "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  get sessionId() {
    return this.session?.id || null;
  }

  /** Raiz do espelho local do repositório, usada para encurtar caminhos. */
  get root() {
    return this.getSession()?.path || "";
  }

  async attach() {
    if (!this.getSession()) return;
    await this.detach();
    this.targetNode.textContent = this.getSession()?.fullName || "";

    try {
      const { session, models, agents } = await api.session();
      this.session = session;
      this.models = models || [];
      this.agents = agents || [];
      this.renderSelectors();
      await this.renderHistory();
      this.pollPermissions();
    } catch (err) {
      this.log("system", `Não foi possível iniciar o OpenCode: ${err.message}`);
    }
  }

  async detach() {
    clearInterval(this.permissionTimer);
    this.permissionTimer = null;
    this.session = null;
    this.stream = null;
    this.toolNodes?.clear();
    this.setBusy(false);
  }

  renderSelectors() {
    const currentModel = this.session?.model;
    clear(this.modelSelect);
    this.modelSelect.append(new Option("modelo padrão", ""));
    for (const model of this.models) {
      const providerID = model.providerID || model.canonical;
      if (!providerID) continue;
      const label = model.name ? `${model.name} (${providerID})` : `${providerID}/${model.id}`;
      const option = new Option(label, `${providerID}/${model.id}`);
      if (currentModel && currentModel.id === model.id && currentModel.providerID === providerID) {
        option.selected = true;
      }
      this.modelSelect.append(option);
    }

    const currentAgent = this.session?.agent;
    clear(this.agentSelect);
    this.agentSelect.append(new Option("agente padrão", ""));
    for (const agent of this.agents) {
      if (agent.hidden) continue;
      const option = new Option(agent.name || agent.id, agent.id);
      if (currentAgent === agent.id) option.selected = true;
      this.agentSelect.append(option);
    }
  }

  async renderHistory() {
    if (!this.session) return;
    try {
      const { messages } = await api.get("/api/opencode/messages");
      clear(this.logNode);
      this.logNode.append(
        el("div", {
          class: "terminal-hint",
          html:
            "O OpenCode opera apenas dentro do repositório selecionado. Use <kbd>Enter</kbd> para enviar e " +
            "<kbd>Shift</kbd>+<kbd>Enter</kbd> para uma nova linha.",
        }),
      );

      const ordered = [...messages].reverse();
      for (const message of ordered) {
        if (message.type === "user") {
          this.log("user", message.text || message.payload?.text || "");
        } else if (message.type === "assistant") {
          for (const part of message.content || []) {
            if (part.type === "text") {
              this.log("assistant", part.text);
            } else if (part.type === "tool") {
              this.logTool(part.name, part.state?.input, part.state?.status);
            }
          }
          if (message.cost) {
            this.logMeta(
              `modelo <b>${message.model?.id || "?"}</b> · tokens <b>${message.tokens?.input || 0}↑ ${message.tokens?.output || 0}↓</b>`,
            );
          }
        }
      }
    } catch (err) {
      this.log("error", `Histórico indisponível: ${err.message}`);
    }
  }

  async send() {
    const text = this.inputNode.value.trim();
    if (!text) return;
    if (!this.session) {
      this.log("system", "Aguardando o repositório ser aberto...");
      return;
    }

    this.inputNode.value = "";
    this.inputNode.style.height = "auto";
    this.log("user", text);

    try {
      await api.prompt(text);
      this.setBusy(true);
    } catch (err) {
      this.log("error", err.message);
      this.setBusy(false);
    }
  }

  async interrupt() {
    try {
      await api.interrupt();
      this.log("system", "Interrompido pelo usuário.");
    } catch (err) {
      this.log("error", err.message);
    } finally {
      this.setBusy(false);
    }
  }

  async newSession() {
    try {
      const { session } = await api.newSession(
        this.agentSelect.value || undefined,
        this.modelSelect.value || undefined,
      );
      this.session = session;
      clear(this.logNode);
      this.log("system", "Nova sessão iniciada.");
    } catch (err) {
      this.log("error", err.message);
    }
  }

  clear() {
    clear(this.logNode);
    this.log("system", "Terminal limpo.");
  }

  setBusy(busy) {
    this.busy = busy;
    this.interruptButton.disabled = !busy;
    this.inputNode.placeholder = busy
      ? "processando... (Esc para interromper)"
      : "peça ao OpenCode para analisar ou modificar o repositório...";
  }

  /* ------------------------------------------------------------- render */

  log(kind, text) {
    const line = el("div", { class: `term-line ${kind}` });
    if (kind === "user") {
      line.append(el("span", { class: "term-sym", text: "❯" }));
      line.append(document.createTextNode(text));
    } else {
      line.textContent = text;
    }
    this.logNode.append(line);
    this.scrollToEnd();
    return line;
  }

  logMeta(text) {
    const line = el("div", { class: "term-meta", html: text });
    this.logNode.append(line);
    this.scrollToEnd();
  }

  logTool(name, input, status) {
    const line = el("div", { class: "term-line tool" });
    line.append(el("span", { text: "● " }));
    line.append(el("span", { class: "tool-title", text: summarize(name, input || {}, this.root) }));
    const marks = { completed: "✓", error: "✗", running: "…" };
    line.append(el("span", { class: "tool-status", text: ` ${marks[status] || ""}` }));
    this.logNode.append(line);
    this.scrollToEnd();
    return line;
  }

  scrollToEnd() {
    this.logNode.scrollTop = this.logNode.scrollHeight;
  }

  /* ------------------------------------------------------------- events */

  handleEvent(event) {
    const data = event.data || {};
    const type = event.type || "";
    const sessionID = data.sessionID;

    if (sessionID && this.session && sessionID !== this.session.id) return;

    switch (type) {
      case "session.text.delta": {
        const key = data.assistantMessageID;
        if (!this.stream || this.stream.key !== key) {
          this.stream = { key, node: el("div", { class: "term-inline term-line assistant" }) };
          this.logNode.append(this.stream.node);
        }
        this.stream.node.append(document.createTextNode(data.delta || ""));
        this.scrollToEnd();
        break;
      }
      case "session.text.ended": {
        if (this.stream) {
          this.stream = null;
          this.logNode.append(el("div", { class: "term-meta", text: " " }));
        }
        break;
      }
      case "session.tool.input.started": {
        this.toolNodes = this.toolNodes || new Map();
        const node = this.logTool(data.name, {}, "running");
        this.toolNodes.set(data.id, { node, name: data.name, input: {} });
        break;
      }
      case "session.tool.input.ended": {
        const entry = this.toolNodes?.get(data.id);
        if (!entry) break;
        try {
          entry.input = JSON.parse(data.text || "{}");
        } catch {
          entry.input = { raw: data.text };
        }
        entry.node.replaceChildren(
          el("span", { text: "● " }),
          el("span", { class: "tool-title", text: summarize(entry.name, entry.input, this.root) }),
          el("span", { class: "tool-status", text: " …" }),
        );
        break;
      }
      case "session.tool.called": {
        const entry = this.toolNodes?.get(data.id);
        if (entry) {
          entry.input = data.input || entry.input;
          entry.node.replaceChildren(
            el("span", { text: "● " }),
            el("span", { class: "tool-title", text: summarize(entry.name, entry.input, this.root) }),
            el("span", { class: "tool-status", text: " …" }),
          );
        }
        break;
      }
      case "session.tool.success": {
        const entry = this.toolNodes?.get(data.id);
        if (entry) {
          entry.node.replaceChildren(
            el("span", { text: "● " }),
            el("span", { class: "tool-title", text: summarize(entry.name, entry.input, this.root) }),
            el("span", { class: "tool-status", text: " ✓" }),
          );
          this.toolNodes.delete(data.id);
        }
        break;
      }
      case "session.tool.error": {
        const entry = this.toolNodes?.get(data.id);
        if (entry) {
          entry.node.replaceChildren(
            el("span", { text: "● " }),
            el("span", { class: "tool-title", text: summarize(entry.name, entry.input, this.root) }),
            el("span", { class: "tool-status", text: " ✗" }),
          );
          this.toolNodes.delete(data.id);
        }
        break;
      }
      case "session.execution.started": {
        this.setBusy(true);
        break;
      }
      case "session.execution.succeeded":
      case "session.execution.failed": {
        this.setBusy(false);
        this.stream = null;
        if (data.cost !== undefined) {
          this.logMeta(
            `tokens <b>${data.tokens?.input || 0}↑</b> <b>${data.tokens?.output || 0}↓</b>${
              data.cost ? ` · custo <b>$${data.cost.toFixed(4)}</b>` : ""
            }`,
          );
        }
        this.refreshPermissions();
        break;
      }
      case "session.renamed": {
        if (this.session) this.session.title = data.title;
        break;
      }
      default:
        if (type.includes("permission")) this.refreshPermissions();
        break;
    }
  }

  /* --------------------------------------------------------- permissões */

  pollPermissions() {
    clearInterval(this.permissionTimer);
    this.permissionTimer = setInterval(() => this.refreshPermissions(), 2000);
  }

  async refreshPermissions() {
    if (!this.session) return;
    try {
      const { permissions } = await api.permissions();
      this.renderPermissions(permissions || []);
    } catch {
      /* ignore */
    }
  }

  renderPermissions(permissions) {
    clear(this.permissionsNode);
    if (!permissions.length) {
      this.permissionsNode.hidden = true;
      return;
    }

    this.permissionsNode.hidden = false;
    for (const permission of permissions) {
      const request = permission.request || permission;
      const title =
        request.title ||
        request.description ||
        `${request.type || "permissão"}: ${request.pattern || request.path || ""}`;

      const card = el("div", { class: "permission-card" }, [
        el("span", { class: "permission-text", text: `⚠ ${title}` }),
        el("div", { class: "permission-actions" }, [
          el("button", {
            class: "btn btn-primary",
            text: "Permitir",
            onclick: () => this.reply(permission.id || request.id, "once"),
          }),
          el("button", {
            class: "btn",
            text: "Sempre",
            onclick: () => this.reply(permission.id || request.id, "always"),
          }),
          el("button", {
            class: "btn btn-ghost",
            text: "Negar",
            onclick: () => this.reply(permission.id || request.id, "reject"),
          }),
        ]),
      ]);
      this.permissionsNode.append(card);
    }
  }

  async reply(requestID, decision) {
    try {
      await api.replyPermission(requestID, decision);
      this.log("system", decision === "reject" ? "Permissão negada." : "Permissão concedida.");
      this.refreshPermissions();
    } catch (err) {
      this.log("error", err.message);
    }
  }
}
