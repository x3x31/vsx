const API = "https://api.github.com";
const VERSION = "2022-11-28";

/** Cliente da API do GitHub rodando direto no navegador (usado no GitHub Pages). */
export class GithubClient {
  constructor(token = null) {
    this.token = token;
  }

  setToken(token) {
    this.token = token;
  }

  get connected() {
    return Boolean(this.token);
  }

  async request(method, endpoint, { body, headers = {} } = {}) {
    if (!this.token) throw new Error("Sem token do GitHub");

    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": VERSION,
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!res.ok) {
      const message =
        (payload && payload.message) || `O GitHub respondeu ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        error.message = "Limite de requisições do GitHub excedido. Tente novamente em instantes.";
      }
      throw error;
    }
    return payload;
  }

  async getUser() {
    const user = await this.request("GET", "/user");
    return {
      login: user.login,
      name: user.name,
      avatar: user.avatar_url,
      email: user.email,
    };
  }

  async listRepos() {
    const repos = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.request(
        "GET",
        `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`,
      );
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    return repos.map((repo) => ({
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      description: repo.description || "",
      private: Boolean(repo.private),
      defaultBranch: repo.default_branch,
      language: repo.language,
      stars: repo.stargazers_count,
      updatedAt: repo.updated_at,
      permissions: {
        admin: repo.permissions?.admin ?? false,
        push: repo.permissions?.push ?? false,
        pull: repo.permissions?.pull ?? false,
      },
    }));
  }

  async listBranches(fullName) {
    const branches = await this.request("GET", `/repos/${fullName}/branches?per_page=100`);
    return branches.map((branch) => ({ name: branch.name, sha: branch.commit.sha }));
  }

  async getRepo(fullName) {
    const repo = await this.request("GET", `/repos/${fullName}`);
    return {
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      permissions: {
        admin: repo.permissions?.admin ?? false,
        push: repo.permissions?.push ?? false,
        pull: repo.permissions?.pull ?? false,
      },
    };
  }

  /** Árvore de arquivos do repositório (respeita o que está no branch). */
  async getTree(fullName, branch) {
    const result = await this.request(
      "GET",
      `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
    return {
      truncated: Boolean(result.truncated),
      baseSha: result.sha,
      files: (result.tree || [])
        .filter((entry) => entry.type === "blob")
        .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size, mode: entry.mode })),
    };
  }

  async getContent(fullName, path, branch) {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const file = await this.request(
      "GET",
      `/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`,
    );

    if (Array.isArray(file)) return { directory: true, entries: file };

    const encoding = file.encoding || "base64";
    const content =
      encoding === "base64"
        ? decodeBase64(file.content || "")
        : decodeURIComponent(file.content || "");

    return {
      directory: false,
      path: file.path,
      content,
      sha: file.sha,
      size: file.size,
      binary: isBinary(content),
    };
  }

  async createBlob(fullName, content) {
    const blob = await this.request("POST", `/repos/${fullName}/git/blobs`, {
      body: { content: encodeBase64(content), encoding: "base64" },
    });
    return blob.sha;
  }

  async createTree(fullName, baseTree, entries) {
    const tree = await this.request("POST", `/repos/${fullName}/git/trees`, {
      body: {
        base_tree: baseTree,
        tree: entries.map((entry) => ({
          path: entry.path,
          mode: entry.mode || "100644",
          type: entry.type || "blob",
          sha: entry.sha,
        })),
      },
    });
    return tree.sha;
  }

  async createCommit(fullName, message, treeSha, parents) {
    const commit = await this.request("POST", `/repos/${fullName}/git/commits`, {
      body: { message, tree: treeSha, parents },
    });
    return commit.sha;
  }

  async updateRef(fullName, branch, sha) {
    await this.request("PATCH", `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, {
      body: { sha, force: false },
    });
  }

  async getRef(fullName, branch) {
    const ref = await this.request(
      "GET",
      `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object?.sha;
  }

  async listCommits(fullName, branch) {
    const commits = await this.request(
      "GET",
      `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=20`,
    );
    return commits.map((commit) => ({
      sha: commit.sha.slice(0, 7),
      message: commit.commit.message.split("\n")[0],
      author: commit.commit.author?.name || "desconhecido",
      date: commit.commit.author?.date,
    }));
  }
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(text) {
  const binary = atob(text.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isBinary(text) {
  return text.includes("\u0000");
}
