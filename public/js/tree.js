import { clear, el } from "./dom.js";

const ICONS = {
  js: "🟨",
  mjs: "🟨",
  cjs: "🟨",
  ts: "🟦",
  tsx: "🟦",
  jsx: "🟦",
  json: "🟧",
  css: "🟦",
  scss: "🟦",
  html: "🟧",
  htm: "🟧",
  md: "📘",
  yml: "🐍",
  yaml: "🐍",
  py: "🐍",
  go: "🐹",
  rs: "🦀",
  sh: "📜",
  toml: "⚙️",
  lock: "🔒",
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  gif: "🖼️",
  svg: "🖼️",
  ico: "🖼️",
  pdf: "📕",
  zip: "🗜️",
};

function iconFor(name, isDir) {
  if (isDir) return "📁";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return ICONS[ext] || "•";
}

function buildTree(files) {
  const root = { name: "", path: "", dir: true, children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    parts.forEach((name, index) => {
      const isFile = index === parts.length - 1;
      const childPath = parts.slice(0, index + 1).join("/");
      if (!node.children.has(name)) {
        node.children.set(name, {
          name,
          path: childPath,
          dir: !isFile,
          tracked: file.tracked,
          children: new Map(),
        });
      }
      node = node.children.get(name);
    });
  }
  return root;
}

export class FileTree {
  constructor({ container, emptyNode, onOpen }) {
    this.container = container;
    this.emptyNode = emptyNode;
    this.onOpen = onOpen;
    this.files = [];
    this.selected = null;
    this.dirty = new Set();
    this.collapsed = new Set();
  }

  setFiles(files) {
    this.files = files || [];
    this.render();
  }

  setSelected(path) {
    this.selected = path;
    if (path) this.reveal(path);
    this.render();
  }

  setDirty(paths) {
    this.dirty = new Set(paths || []);
    this.render();
  }

  reveal(path) {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this.collapsed.delete(current);
    }
  }

  render() {
    clear(this.container);

    if (!this.files.length) {
      this.container.append(this.emptyNode);
      return;
    }

    const root = buildTree(this.files);
    this.renderNode(root, 0, this.container);
  }

  renderNode(node, depth, parent) {
    const entries = [...node.children.values()].sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR", { numeric: true });
    });

    for (const entry of entries) {
      const isCollapsed = this.collapsed.has(entry.path);
      const isSelected = this.selected === entry.path;

      const row = el(
        "div",
        {
          class: [
            "tree-row",
            entry.dir ? "tree-folder" : "tree-file",
            isSelected ? "selected" : "",
            this.dirty.has(entry.path) ? "dirty" : "",
          ]
            .filter(Boolean)
            .join(" "),
          style: `padding-left:${6 + depth * 12}px`,
          title: entry.path,
        },
        [
          entry.dir
            ? el("span", { class: `tree-caret${isCollapsed ? "" : " open"}`, text: "▶" })
            : el("span", { class: "tree-caret" }),
          el("span", { class: "tree-icon", text: iconFor(entry.name, entry.dir) }),
          el("span", { class: "tree-name", text: entry.name }),
        ],
      );

      const children = el("div", { class: `tree-children${isCollapsed ? " collapsed" : ""}` });

      row.addEventListener("click", (event) => {
        event.stopPropagation();
        if (entry.dir) {
          if (this.collapsed.has(entry.path)) this.collapsed.delete(entry.path);
          else this.collapsed.add(entry.path);
          this.render();
        } else {
          this.onOpen(entry.path);
        }
      });

      parent.append(row);
      if (entry.dir) {
        this.renderNode(entry, depth + 1, children);
        parent.append(children);
      }
    }
  }
}
