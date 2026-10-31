const API = "https://api.github.com";
const VERSION = "2022-11-28";

export class GitHubError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

async function request(token, method, endpoint, body) {
  if (!token) throw new GitHubError("O VSX não enviou o token do GitHub", 401);

  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": VERSION,
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
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
    throw new GitHubError(message, res.status);
  }
  return payload;
}

function mapRepo(repo) {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login,
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
  };
}

export async function listRepos(token) {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await request(
      token,
      "GET",
      `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.map(mapRepo);
}

export async function listBranches(token, fullName) {
  const branches = await request(token, "GET", `/repos/${fullName}/branches?per_page=100`);
  return branches.map((branch) => ({ name: branch.name, sha: branch.commit.sha }));
}

export async function getRepo(token, fullName) {
  const repo = await request(token, "GET", `/repos/${fullName}`);
  return {
    ...mapRepo(repo),
    size: repo.size,
  };
}
