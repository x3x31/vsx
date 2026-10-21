import { workspace } from "./api.js";
import { toast } from "./dom.js";

const MODES = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "javascript",
  tsx: "jsx",
  json: { name: "javascript", json: true },
  css: "css",
  scss: "css",
  less: "css",
  html: "htmlmixed",
  htm: "htmlmixed",
  xml: "xml",
  svg: "xml",
  vue: "htmlmixed",
  py: "python",
  md: "markdown",
  markdown: "markdown",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  toml: "toml",
  go: "go",
  rs: "rust",
  java: "text/x-java",
  c: "text/x-csrc",
  cpp: "text/x-c++src",
  h: "text/x-csrc",
  cs: "text/x-csharp",
  php: "application/x-httpd-php",
  rb: "ruby",
  swift: "swift",
  kt: "text/x-kotlin",
  ini: "text/x-ini",
  env: "text/x-ini",
  txt: null,
  lock: null,
};

function modeFor(path) {
  const name = path.split("/").pop().toLowerCase();
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return MODES[ext] ?? null;
}

export class EditorPanel {
  constructor({ host, emptyNode, tabbar, tabbarEmpty, onOpen, onDirty, onSaved }) {
    this.host = host;
    this.emptyNode = emptyNode;
    this.tabbar = tabbar;
    this.tabbarEmpty = tabbarEmpty;
    this.onOpen = onOpen;
    this.onDirty = onDirty;
    this.onSaved = onSaved;

    this.tabs = [];
    this.activePath = null;

    this.cm = window.CodeMirror(host, {
      mode: null,
      theme: "dracula",
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: true,
      smartIndent: true,
      autoCloseBrackets: true,
      autoCloseTags: true,
      matchBrackets: true,
      foldGutter: true,
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
      extraKeys: {
        "Ctrl-S": () => this.save(),
        "Cmd-S": () => this.save(),
      },
    });

    this.cm.on("change", () => {
      if (this.suppressChange) return;
      const tab = this.activeTab;
      if (!tab) return;
      tab.content = this.cm.getValue();
      tab.dirty = true;
      this.renderTabs();
      this.onDirty?.(tab.path);
    });

    this.setEmpty(true);
  }

  setEmpty(empty) {
    if (this.emptyNode) this.emptyNode.hidden = !empty;
    this.cm.getWrapperElement().style.visibility = empty ? "hidden" : "visible";
  }

  get activeTab() {
    return this.tabs.find((tab) => tab.path === this.activePath) || null;
  }

  /** A aba ativa tem alteração que ainda não foi salva? */
  get activeDirty() {
    return Boolean(this.activeTab?.dirty);
  }

  get currentPath() {
    return this.activePath;
  }

  /**
   * O CodeMirror precisa se reajustar quando o espaço muda — janela
   * redimensionada, painel recolhido ou layout em modo celular.
   */
  refresh() {
    this.cm.refresh();
  }

  async open(path) {
    const existing = this.tabs.find((tab) => tab.path === path);
    if (existing) {
      this.activate(path);
      return;
    }

    try {
      const file = await workspace.readFile(path);
      if (file.binary) {
        toast("Arquivo binário — não pode ser editado", "error");
        return;
      }
      this.tabs.push({ path, content: file.content ?? "", dirty: false, scroll: 0 });
      this.activate(path);
    } catch (err) {
      toast(err.message || "Não foi possível abrir o arquivo", "error");
    }
  }

  activate(path) {
    const tab = this.tabs.find((item) => item.path === path);
    if (!tab) return;

    if (this.activeTab && this.activeTab !== tab) {
      this.activeTab.scroll = this.cm.getScrollInfo();
    }

    this.activePath = path;
    this.cm.setOption("mode", modeFor(path));
    this.cm.setOption("readOnly", false);
    this.suppressChange = true;
    this.cm.setValue(tab.content);
    this.cm.clearHistory();
    this.suppressChange = false;
    const scroll = tab.scroll || { left: 0, top: 0 };
    this.cm.scrollTo(scroll.left || 0, scroll.top || 0);
    this.cm.focus();
    this.setEmpty(false);
    this.renderTabs();
    this.onOpen?.(path);
  }

  async save() {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      await workspace.writeFile(tab.path, this.cm.getValue());
      tab.content = this.cm.getValue();
      tab.dirty = false;
      this.renderTabs();
      this.onSaved?.(tab.path);
      toast(`Salvo: ${tab.path}`, "success");
    } catch (err) {
      toast(err.message || "Não foi possível salvar", "error");
    }
  }

  async saveAll() {
    for (const tab of this.tabs.filter((item) => item.dirty)) {
      await workspace.writeFile(tab.path, tab.content);
      tab.dirty = false;
    }
    this.renderTabs();
  }

  close(path) {
    const index = this.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    this.tabs.splice(index, 1);

    if (this.activePath === path) {
      this.activePath = null;
      const next = this.tabs[index] || this.tabs[index - 1];
      if (next) this.activate(next.path);
      else {
        this.cm.setValue("");
        this.cm.setOption("readOnly", true);
        this.setEmpty(true);
        this.renderTabs();
      }
    } else {
      this.renderTabs();
    }
  }

  closeAll() {
    this.tabs = [];
    this.activePath = null;
    this.suppressChange = true;
    this.cm.setValue("");
    this.suppressChange = false;
    this.cm.setOption("readOnly", true);
    this.setEmpty(true);
    this.renderTabs();
    this.onOpen?.(null);
  }

  isDirty(path) {
    return Boolean(this.tabs.find((tab) => tab.path === path)?.dirty);
  }

  refreshFromDisk(path) {
    const tab = this.tabs.find((item) => item.path === path);
    if (!tab || tab.dirty) return;
    workspace
      .readFile(path)
      .then((file) => {
        tab.content = file.content ?? "";
        if (this.activePath === path) {
          this.suppressChange = true;
          this.cm.setValue(tab.content);
          this.suppressChange = false;
        }
      })
      .catch(() => {});
  }

  renderTabs() {
    while (this.tabbar.firstChild) this.tabbar.removeChild(this.tabbar.firstChild);
    if (!this.tabs.length) {
      this.tabbar.append(this.tabbarEmpty);
      return;
    }

    for (const tab of this.tabs) {
      const node = document.createElement("div");
      node.className = `tab${tab.path === this.activePath ? " active" : ""}${tab.dirty ? " dirty" : ""}`;
      node.title = tab.path;

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = tab.path.split("/").pop();
      node.append(name);

      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Fechar";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        this.close(tab.path);
      });
      node.append(close);

      node.addEventListener("click", () => this.activate(tab.path));
      this.tabbar.append(node);
    }
  }
}
