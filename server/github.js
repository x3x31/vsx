import { resolveToken } from "./config.js";

const API = process.env.GITHUB_API_URL || "https://api.github.com";
const VERSION = "2022-11-28";

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.body = body;
  }
}

export class GitHub {
  #token = null;
  #config;

  constructor(config) {
    this.#config = config;
    this.#token = resolveToken(config);
  }

  get token() {
    return this.#token;
  }

  get connected() {
    return Boolean(this.#token);
  }

  setToken(token) {
    this.#token = token || null;
    if (token) this.#config = { ...this.#config, token };
  }

  clearToken() {
    this.#token = null;
  }

  async request(method, endpoint, { body, raw, headers = {} } = {}) {
    if (!this.#token) throw new GitHubError("Nao ha conexao com o GitHub", 401, null);

    const url = endpoint.startsWith("http") ? endpoint : `${API}${endpoint}`;
    const init = {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": VERSION,
        "user-agent": "vsx",
        ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
        ...headers,
      },
    };

    if (body !== undefined) {
      if (typeof body === "string" || Buffer.isBuffer(body)) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers["content-type"] = "application/json";
      }
    }

    const res = await fetch(url, init);

    if (raw) {
      if (!res.ok) throw new GitHubError(`GitHub respondeu ${res.status}`, res.status, null);
      return res;
    }

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
        (payload && payload.message) ||
        (typeof payload === "string" && payload.slice(0, 200)) ||
        `GitHub respondeu ${res.status}`;
      const err = new GitHubError(message, res.status, payload);
      if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        err.message = `Limite de requisicoes do GitHub excedido. Tente novamente as ${res.headers.get("x-ratelimit-reset")}.`;
      }
      throw err;
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

  /** Repositorios onde o usuario tem permissao de escrita. */
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

  async getRepo(fullName) {
    const repo = await this.request("GET", `/repos/${fullName}`);
    return {
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      size: repo.size,
      permissions: {
        admin: repo.permissions?.admin ?? false,
        push: repo.permissions?.push ?? false,
        pull: repo.permissions?.pull ?? false,
      },
    };
  }

  async listBranches(fullName) {
    const branches = await this.request("GET", `/repos/${fullName}/branches?per_page=100`);
    return branches.map((b) => ({ name: b.name, sha: b.commit.sha }));
  }

  async listCommits(fullName, branch) {
    const commits = await this.request(
      "GET",
      `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=20`,
    );
    return commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name || "desconhecido",
      date: c.commit.author?.date,
    }));
  }

  async getContents(fullName, filePath, ref) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.request("GET", `/repos/${fullName}/contents/${filePath}${query}`);
  }
}
