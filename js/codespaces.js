const API = "https://api.github.com";

export class CodespacesClient {
  constructor(getToken) {
    this.getToken = getToken;
  }

  async request(method, endpoint, body) {
    const token = this.getToken?.();
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
        (payload && payload.message) ||
        (typeof payload === "string" ? payload : `GitHub respondeu ${res.status}`);
      const err = new Error(message);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  /** Listar Codespaces do usuário. */
  list() {
    return this.request("GET", "/user/codespaces");
  }

  /** Criar Codespace a partir de um repositório/template. */
  create({ repository_id, ref, machine, location, idle_timeout_minutes }) {
    const body = { repository_id };
    if (ref) body.ref = ref;
    if (machine) body.machine = machine;
    if (location) body.location = location;
    if (idle_timeout_minutes) body.idle_timeout_minutes = idle_timeout_minutes;
    return this.request("POST", "/user/codespaces", body);
  }

  /** Obter detalhes de um Codespace. */
  get(name) {
    return this.request("GET", `/user/codespaces/${encodeURIComponent(name)}`);
  }

  /** Iniciar um Codespace parado. */
  start(name) {
    return this.request("POST", `/user/codespaces/${encodeURIComponent(name)}/start`);
  }

  /** Parar um Codespace. */
  stop(name) {
    return this.request("POST", `/user/codespaces/${encodeURIComponent(name)}/stop`);
  }

  /** Deletar um Codespace. */
  remove(name) {
    return this.request("DELETE", `/user/codespaces/${encodeURIComponent(name)}`);
  }
}
