import { clear, el } from "./dom.js";
import { fileIcon } from "./icons.js";

/** Ícone do tipo do arquivo, o mesmo do tema Seti usado pelo VS Code. */
function fileIconNode(name) {
  const [char, color] = fileIcon(name);
  const icon = el("span", { class: "tree-icon seti-icon", "aria-hidden": "true", text: char });
  icon.style.color = color;
  return icon;
}

/** Pasta fechada/aberta (codicon), como na árvore do VS Code. */
function folderIconNode(open) {
  return el("span", {
    class: `tree-icon codicon ${open ? "codicon-folder-opened" : "codicon-folder"}`,
    "aria-hidden": "true",
  });
}

/** Chevron de pasta recolhida/aberta (codicon), como no VS Code. */
function caretNode(isDir, open) {
  if (!isDir) return el("span", { class: "tree-caret", "aria-hidden": "true" });
  return el("span", {
    class: `tree-caret codicon ${open ? "codicon-chevron-down" : "codicon-chevron-right"}`,
    "aria-hidden": "true",
  });
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
    // Pastas começam recolhidas: só aparece expandida a que estiver aqui.
    this.expanded = new Set();
  }

  setFiles(files) {
    this.files = files || [];
    // Descarta pastas que deixaram de existir, mantendo o que estava aberto.
    const dirs = new Set();
    for (const file of this.files) {
      const parts = file.path.split("/").filter(Boolean);
      parts.pop();
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        dirs.add(current);
      }
    }
    for (const path of this.expanded) {
      if (!dirs.has(path)) this.expanded.delete(path);
    }
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
      this.expanded.add(current);
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
      const isOpen = entry.dir && this.expanded.has(entry.path);
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
          role: "treeitem",
          "aria-expanded": entry.dir ? String(isOpen) : undefined,
        },
        [
          caretNode(entry.dir, isOpen),
          entry.dir ? folderIconNode(isOpen) : fileIconNode(entry.name),
          el("span", { class: "tree-name", text: entry.name }),
        ],
      );

      const children = el("div", {
        class: `tree-children${entry.dir && !isOpen ? " collapsed" : ""}`,
        role: "group",
      });

      row.addEventListener("click", (event) => {
        event.stopPropagation();
        if (entry.dir) {
          if (this.expanded.has(entry.path)) this.expanded.delete(entry.path);
          else this.expanded.add(entry.path);
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
