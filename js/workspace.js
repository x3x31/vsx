/**
 * Camada de acesso aos arquivos do repositório.
 *
 * O vsx funciona em dois modos:
 *  - "ponte": usa o servidor Node local (espelho git + opencode). Modo completo.
 *  - "github": usa a API do GitHub direto pelo navegador. Modo sem servidor,
 *    ideal para o GitHub Pages (o terminal OpenCode continua precisando da ponte).
 */
export class Workspace {
  constructor({ github, bridge }) {
    this.github = github;
    this.bridge = bridge;
    this.mode = "github";
    this.repo = null;
    this.branch = null;
    this.files = new Map();
    this.treeSha = null;
    this.changes = new Map();
  }

  get online() {
    return this.mode === "bridge";
  }

  /** Descobre se a ponte local está disponível e escolhe o modo. */
  async detect(force = null) {
    const info = await this.bridge.ping();
    this.mode = force || (info ? "bridge" : "github");
    return { mode: this.mode, info };
  }

  setMode(mode) {
    this.mode = mode;
  }

  /* ------------------------------------------------------------- repos */

  async listRepos() {
    if (this.mode === "bridge") {
      const { repos } = await this.bridge.request("GET", "/api/github/repos");
      return repos;
    }
    return this.github.listRepos();
  }

  async listBranches(fullName) {
    if (this.mode === "bridge") {
      const { branches } = await this.bridge.request(
        "GET",
        `/api/github/branches?repo=${encodeURIComponent(fullName)}`,
      );
      return branches;
    }
    return this.github.listBranches(fullName);
  }

  /* ------------------------------------------------------------ arquivos */

  async open(fullName, branch) {
    this.changes.clear();
    this.files.clear();

    if (this.mode === "bridge") {
      const result = await this.bridge.prepareWorkspace(fullName, branch);
      this.repo = result.repo;
      this.branch = result.repo.branch;
      for (const file of result.files || []) {
        this.files.set(file.path, { tracked: file.tracked });
      }
      return {
        repo: this.repo,
        files: [...this.files.keys()].map((path) => ({ path })),
        branch: this.branch,
        permissions: result.repo.permissions || { push: true },
        status: result.status || [],
      };
    }

    const info = await this.github.getRepo(fullName);
    const target = branch || info.defaultBranch;
    const tree = await this.github.getTree(fullName, target);

    this.repo = { fullName, path: null, permissions: info.permissions };
    this.branch = target;
    this.treeSha = tree.baseSha || null;

    const files = tree.files.map((file) => {
      this.files.set(file.path, { sha: file.sha, size: file.size });
      return { path: file.path };
    });

    return { repo: this.repo, files, branch: target, permissions: info.permissions, status: [] };
  }

  async readFile(path) {
    if (this.mode === "bridge") {
      return this.bridge.request(
        "GET",
        `/api/workspace/file?path=${encodeURIComponent(path)}`,
      );
    }

    const pending = this.changes.get(path);
    if (pending?.status === "deleted") {
      throw new Error("Arquivo removido");
    }
    if (pending?.status === "modified" || pending?.status === "added") {
      return { content: pending.content, sha: pending.sha, binary: false, path };
    }

    const file = await this.github.getContent(this.repo.fullName, path, this.branch);
    return { content: file.content, sha: file.sha, binary: file.binary, path };
  }

  async writeFile(path, content) {
    if (this.mode === "bridge") {
      return this.bridge.request("PUT", "/api/workspace/file", { path, content });
    }

    const known = this.files.get(path);
    const current = this.changes.get(path);
    this.changes.set(path, {
      status: current?.status === "added" ? "added" : "modified",
      content,
      sha: known?.sha || null,
      mode: known?.mode || "100644",
    });
    return { path, sha: null };
  }

  async createFile(path, content = "") {
    if (this.mode === "bridge") {
      return this.bridge.request("POST", "/api/workspace/new", { path, content });
    }
    this.files.set(path, { sha: null, mode: "100644" });
    this.changes.set(path, { status: "added", content, sha: null, mode: "100644" });
    return { path };
  }

  async removeFile(path) {
    if (this.mode === "bridge") {
      return this.bridge.request("DELETE", "/api/workspace/file", { path });
    }
    const known = this.files.get(path);
    this.changes.set(path, {
      status: "deleted",
      content: null,
      sha: known?.sha || null,
      mode: known?.mode || "100644",
    });
    return { path };
  }

  /* -------------------------------------------------------------- git */

  async listChanges() {
    if (this.mode === "bridge") {
      const status = await this.bridge.workspaceStatus();
      return status.entries || [];
    }
    return [...this.changes.entries()].map(([path, change]) => ({
      path,
      status: change.status,
      staged: false,
    }));
  }

  async discard(path) {
    if (this.mode === "bridge") {
      return this.bridge.request("POST", "/api/workspace/discard", { path });
    }
    this.changes.delete(path);
    return { ok: true };
  }

  /** Envia as alterações pendentes para o GitHub em um único commit. */
  async commit(message) {
    if (this.mode === "bridge") {
      return this.bridge.request("POST", "/api/workspace/commit", {
        message,
        branch: this.branch,
      });
    }

    if (!this.changes.size) throw new Error("Não há alterações para enviar");

    const fullName = this.repo.fullName;
    const entries = [];

    for (const [path, change] of this.changes) {
      if (change.status === "deleted") {
        entries.push({ path, mode: change.mode, type: "blob", sha: null });
        continue;
      }
      const blobSha = await this.github.createBlob(fullName, change.content ?? "");
      entries.push({ path, mode: change.mode, type: "blob", sha: blobSha });
    }

    const baseTree = await this.github.getTree(fullName, this.branch).then(
      (tree) => tree.baseSha,
    );
    const treeSha = await this.github.createTree(fullName, baseTree, entries);
    const head = await this.github.getRef(fullName, this.branch);
    const commitSha = await this.github.createCommit(fullName, message, treeSha, [head]);
    await this.github.updateRef(fullName, this.branch, commitSha);

    this.changes.clear();
    return { sha: commitSha.slice(0, 7), branch: this.branch, pushed: true };
  }
}
