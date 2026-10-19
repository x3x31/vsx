import { api } from "./api.js";
import { clear, el, relativeTime } from "./dom.js";

export class RepoPanel {
  constructor({ listNode, searchNode, reloadNode, onSelect }) {
    this.listNode = listNode;
    this.searchNode = searchNode;
    this.reloadNode = reloadNode;
    this.onSelect = onSelect;
    this.repos = [];
    this.active = null;
    this.filter = "";

    searchNode.addEventListener("input", () => {
      this.filter = searchNode.value.trim().toLowerCase();
      this.render();
    });

    reloadNode.addEventListener("click", () => this.load());
  }

  async load() {
    this.listNode.style.opacity = "0.5";
    try {
      const { repos } = await api.repos();
      this.repos = repos;
      this.render();
    } catch (err) {
      this.listNode.replaceChildren(
        el("div", { class: "empty-state", text: err.message || "Não foi possível carregar os repositórios" }),
      );
    } finally {
      this.listNode.style.opacity = "1";
    }
  }

  setActive(fullName) {
    this.active = fullName;
    this.render();
  }

  render() {
    clear(this.listNode);

    const filtered = this.repos.filter((repo) => {
      if (!this.filter) return true;
      return (
        repo.fullName.toLowerCase().includes(this.filter) ||
        (repo.description || "").toLowerCase().includes(this.filter)
      );
    });

    if (!filtered.length) {
      this.listNode.append(
        el("div", {
          class: "empty-state",
          text: this.repos.length ? "Nenhum repositório encontrado" : "Nenhum repositório disponível",
        }),
      );
      return;
    }

    for (const repo of filtered) {
      const item = el(
        "div",
        {
          class: `repo-item${repo.fullName === this.active ? " active" : ""}`,
          title: repo.description || repo.fullName,
          onclick: () => this.onSelect(repo),
        },
        [
          el("span", { class: "repo-icon", text: repo.private ? "🔒" : "📦" }),
          el("span", { class: "repo-meta" }, [
            el("span", { class: "repo-full" }, [
              el("span", { class: "owner", text: `${repo.owner}/` }),
              repo.name,
            ]),
            el("span", {
              class: "repo-sub",
              text: [
                repo.description || "sem descrição",
                repo.permissions.push ? "pode escrever" : "somente leitura",
                relativeTime(repo.updatedAt),
              ]
                .filter(Boolean)
                .join(" · "),
            }),
          ]),
          repo.permissions.push ? null : el("span", { class: "repo-lock", text: "🔒" }),
        ],
      );
      this.listNode.append(item);
    }
  }
}
