import { el, clear } from "./dom.js";

const LABELS = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export class GitPanel {
  constructor({ container, listNode, countNode, onOpenFile }) {
    this.container = container;
    this.listNode = listNode;
    this.countNode = countNode;
    this.onOpenFile = onOpenFile;
    this.entries = [];
  }

  setStatus(status = {}) {
    this.entries = status.entries || [];
    this.render();
  }

  render() {
    clear(this.listNode);
    this.countNode.textContent = String(this.entries.length);
    this.container.hidden = this.entries.length === 0;

    for (const entry of this.entries) {
      const row = el(
        "div",
        { class: "change-row", title: entry.path, onclick: () => this.onOpenFile(entry.path) },
        [
          el("span", { class: `change-badge ${entry.status}`, text: LABELS[entry.status] || "M" }),
          el("span", { class: "change-path", text: entry.path }),
        ],
      );
      this.listNode.append(row);
    }
  }
}
