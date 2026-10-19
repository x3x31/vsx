const JSON_HEADERS = { "content-type": "application/json" };

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!res.ok) {
    const error = new Error(payload?.error || `Falha na requisição (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return payload ?? {};
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  put: (path, body) => request("PUT", path, body ?? {}),
  del: (path, body) => request("DELETE", path, body ?? {}),

  state: () => request("GET", "/api/state"),
  connect: (token) => request("POST", "/api/github/connect", { token }),
  disconnect: () => request("POST", "/api/github/disconnect", {}),
  repos: () => request("GET", "/api/github/repos"),
  user: () => request("GET", "/api/github/user"),

  openRepo: (repo, branch) => request("POST", "/api/workspace/open", { repo, branch }),
  files: () => request("GET", "/api/workspace/files"),
  readFile: (path) => request("GET", `/api/workspace/file?path=${encodeURIComponent(path)}`),
  writeFile: (path, content) => request("PUT", "/api/workspace/file", { path, content }),
  newFile: (path, content) => request("POST", "/api/workspace/new", { path, content }),
  removeFile: (path) => request("DELETE", "/api/workspace/file", { path }),
  status: () => request("GET", "/api/workspace/status"),
  diff: (path) => request("GET", `/api/workspace/diff?path=${encodeURIComponent(path)}`),
  commit: (message, branch) => request("POST", "/api/workspace/commit", { message, branch }),
  discard: (path) => request("POST", "/api/workspace/discard", { path }),

  opencodeStatus: () => request("GET", "/api/opencode/status"),
  session: () => request("GET", "/api/opencode/session"),
  newSession: (agent, model) => request("POST", "/api/opencode/session/new", { agent, model }),
  prompt: (text, files) => request("POST", "/api/opencode/prompt", { text, files }),
  interrupt: () => request("POST", "/api/opencode/interrupt", {}),
  permissions: () => request("GET", "/api/opencode/permission"),
  replyPermission: (requestID, decision, message) =>
    request("POST", "/api/opencode/permission", { requestID, decision, message }),
};

/** Conexão SSE com o servidor: eventos da aplicação e do OpenCode. */
export function connectStream(handlers) {
  const source = new EventSource("/api/stream");

  source.addEventListener("hello", () => handlers.hello?.());
  source.addEventListener("opencode", (event) => {
    try {
      handlers.opencode?.(JSON.parse(event.data));
    } catch {
      /* payload inválido */
    }
  });
  source.addEventListener("opencode.error", (event) => {
    try {
      handlers.opencodeError?.(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  });
  source.addEventListener("git.status", (event) => {
    try {
      handlers.gitStatus?.(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  });
  source.addEventListener("fs.changed", (event) => {
    try {
      handlers.filesChanged?.(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  });
  source.addEventListener("workspace.opened", (event) => {
    try {
      handlers.workspaceOpened?.(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  });

  source.onerror = () => handlers.error?.();
  return source;
}
